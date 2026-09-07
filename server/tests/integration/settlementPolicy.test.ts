import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestEnv, ctx } from "../helpers/testEnv.js";
import { originateLoan } from "../helpers/originate.js";

/**
 * P3: what early settlement costs is a priced term. It is frozen onto the
 * loan's snapshot, so repricing a product cannot change the deal an existing
 * borrower agreed to.
 */
describe("Settlement policy", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeEach(async () => {
    env = await createTestEnv(new Date("2026-01-01T09:00:00Z"));
  });

  afterEach(async () => {
    await env.cleanup();
  });

  const admin = () => ctx(env.users.userIds.ADMIN!);
  const manager = () => ctx(env.users.userIds.MANAGER!);

  it("defaults a loan to full contract interest and freezes it on the snapshot", async () => {
    const { loanId } = await originateLoan(env);
    const snapshot = await env.db.loanSnapshot.findUniqueOrThrow({ where: { loanId } });
    expect(snapshot.settlementPolicy).toBe("FULL_CONTRACT_INTEREST");
  });

  it("quotes a full-interest payoff equal to the whole outstanding balance", async () => {
    const { loanId } = await originateLoan(env);
    env.clock.set(new Date("2026-02-10T09:00:00Z"));

    const quote = await env.container.payments.settlementQuote(loanId);
    expect(quote.policy).toBe("FULL_CONTRACT_INTEREST");
    expect(quote.rebate).toBe("0.00");
    expect(quote.interestPayable).toBe("3750.00");
    expect(quote.payoffAmount).toBe("53750.00");
    expect(quote.settleable).toBe(true);

    // It still reports the split, so an operator can see what a rebate
    // policy would have waived.
    expect(quote.earnedInterest).toBe("1250.00");
    expect(quote.unearnedInterest).toBe("2500.00");
  });

  it("settles a full-interest loan for exactly the quoted amount", async () => {
    const { loanId } = await originateLoan(env);
    env.clock.set(new Date("2026-02-10T09:00:00Z"));
    const quote = await env.container.payments.settlementQuote(loanId);

    await env.container.payments.create(
      { loanId, amount: quote.payoffAmount, idempotencyKey: "settle-full" },
      manager()
    );

    const loan = await env.db.loan.findUniqueOrThrow({ where: { id: loanId } });
    expect(loan.status).toBe("PAID_OFF");
    const settlement = await env.db.settlement.findUniqueOrThrow({ where: { loanId } });
    expect(settlement.totalPaidCents).toBe(5375000);
  });

  describe("changing the policy is a repricing", () => {
    it("creates a new product version and leaves live loans alone", async () => {
      const { loanId } = await originateLoan(env);

      const v2 = await env.container.products.update(
        env.users.productId,
        { settlementPolicy: "UNACCRUED_INTEREST_REBATE" },
        admin()
      );

      expect(v2.id).not.toBe(env.users.productId);
      expect(v2.version).toBe(2);
      expect(v2.settlementPolicy).toBe("UNACCRUED_INTEREST_REBATE");

      const v1 = await env.db.loanProduct.findUniqueOrThrow({ where: { id: env.users.productId } });
      expect(v1.status).toBe("ARCHIVED");
      expect(v1.settlementPolicy).toBe("FULL_CONTRACT_INTEREST");

      // The existing borrower's terms are untouched.
      const snapshot = await env.db.loanSnapshot.findUniqueOrThrow({ where: { loanId } });
      expect(snapshot.settlementPolicy).toBe("FULL_CONTRACT_INTEREST");

      const quote = await env.container.payments.settlementQuote(loanId);
      expect(quote.policy).toBe("FULL_CONTRACT_INTEREST");
      expect(quote.rebate).toBe("0.00");
    });

    it("applies the new policy to loans written on the new version", async () => {
      const v2 = await env.container.products.update(
        env.users.productId,
        { settlementPolicy: "UNACCRUED_INTEREST_REBATE" },
        admin()
      );

      const customer = await env.container.customers.create(
        {
          name: "回饋政策客戶",
          identityNumber: "R123456789",
          dateOfBirth: "1990-01-01",
          phone: "0912345000",
          monthlyIncome: 80000,
        },
        ctx(env.users.userIds.LOAN_OFFICER!)
      );
      const application = await env.container.applications.create(
        {
          customerId: customer.id,
          requestedProductId: v2.id,
          requestedAmount: 50000,
          requestedTermCount: 3,
          income: 80000,
        },
        ctx(env.users.userIds.LOAN_OFFICER!)
      );
      await env.container.applications.submit(application.id, ctx(env.users.userIds.LOAN_OFFICER!));
      await env.container.approvals.approve(application.id, { reason: "ok" }, manager());
      const loan = await env.container.loans.createFromApprovedApplication(application.id, manager());
      await env.container.loans.disburse(
        loan.id,
        { idempotencyKey: `d-${loan.id}` },
        manager()
      );

      const snapshot = await env.db.loanSnapshot.findUniqueOrThrow({ where: { loanId: loan.id } });
      expect(snapshot.settlementPolicy).toBe("UNACCRUED_INTEREST_REBATE");

      env.clock.set(new Date("2026-02-10T09:00:00Z"));
      const quote = await env.container.payments.settlementQuote(loan.id);
      expect(quote.policy).toBe("UNACCRUED_INTEREST_REBATE");
      expect(quote.rebate).toBe("2500.00");
      expect(quote.payoffAmount).toBe("51250.00");
    });

    it("refuses to settle a rebate loan rather than silently overcharging", async () => {
      // The rebate write path needs a ledger change that is out of scope for
      // this sprint. Settling at full contract interest would overcharge a
      // borrower whose contract promises the rebate, so the API refuses.
      const v2 = await env.container.products.update(
        env.users.productId,
        { settlementPolicy: "UNACCRUED_INTEREST_REBATE" },
        admin()
      );
      const customer = await env.container.customers.create(
        {
          name: "回饋政策客戶2",
          identityNumber: "R987654321",
          dateOfBirth: "1990-01-01",
          phone: "0912345001",
          monthlyIncome: 80000,
        },
        ctx(env.users.userIds.LOAN_OFFICER!)
      );
      const application = await env.container.applications.create(
        {
          customerId: customer.id,
          requestedProductId: v2.id,
          requestedAmount: 50000,
          requestedTermCount: 3,
          income: 80000,
        },
        ctx(env.users.userIds.LOAN_OFFICER!)
      );
      await env.container.applications.submit(application.id, ctx(env.users.userIds.LOAN_OFFICER!));
      await env.container.approvals.approve(application.id, { reason: "ok" }, manager());
      const loan = await env.container.loans.createFromApprovedApplication(application.id, manager());
      await env.container.loans.disburse(loan.id, { idempotencyKey: `d2-${loan.id}` }, manager());

      env.clock.set(new Date("2026-02-10T09:00:00Z"));
      const quote = await env.container.payments.settlementQuote(loan.id);
      expect(quote.settleable).toBe(false);

      await expect(env.container.payments.assertSettleable(loan.id)).rejects.toMatchObject({
        code: "SETTLEMENT_POLICY_NOT_IMPLEMENTED",
      });
    });
  });

  it("rejects an unknown policy on a product", async () => {
    await expect(
      env.container.products.create(
        {
          productCode: "BAD",
          name: "bad",
          minAmount: 1000,
          maxAmount: 2000,
          minTermCount: 1,
          maxTermCount: 2,
          ratePercent: 1,
          rateUnit: "MONTHLY",
          calculationMethod: "SIMPLE_INTEREST",
          repaymentMethod: "INTEREST_ONLY",
          settlementPolicy: "MADE_UP" as never,
        },
        admin()
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
