import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, ctx } from "../helpers/testEnv.js";
import { Money } from "../../src/shared/money.js";

/**
 * The full lending lifecycle from §65, driven end to end through the real
 * services with a MockClock. Assertions check the ledger and the state
 * machine, not just that calls returned without throwing.
 */
describe("Lending lifecycle", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;
  let customerId: string;
  let applicationId: string;
  let loanId: string;

  beforeAll(async () => {
    env = await createTestEnv(new Date("2026-01-01T09:00:00Z"));
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it("creates a customer", async () => {
    const customer = await env.container.customers.create(
      {
        name: "測試客戶",
        identityNumber: "A123456789",
        dateOfBirth: "1990-03-15",
        phone: "0912345678",
        monthlyIncome: 60000,
        employmentStatus: "EMPLOYED",
      },
      ctx(env.users.userIds.LOAN_OFFICER!)
    );
    customerId = customer.id;
    expect(customer.customerNumber).toBe("CUS-000001");
    expect(customer.status).toBe("ACTIVE");
  });

  it("creates a lending application in DRAFT", async () => {
    const application = await env.container.applications.create(
      {
        customerId,
        requestedProductId: env.users.productId,
        requestedAmount: 50000,
        requestedTermMonths: 3,
        purpose: "營運週轉",
        income: 60000,
        existingDebt: 0,
      },
      ctx(env.users.userIds.LOAN_OFFICER!)
    );
    applicationId = application.id;
    expect(application.status).toBe("DRAFT");
  });

  it("runs risk, limit and pricing on submit", async () => {
    const result = await env.container.applications.submit(
      applicationId,
      ctx(env.users.userIds.LOAN_OFFICER!)
    );

    expect(result.assessment.grade).toBeTruthy();
    expect(result.assessment.modelVersion).toBe("rule-based-v1");
    expect(result.limit.decision).toBe("LIMIT_AVAILABLE");
    expect(result.offer).not.toBeNull();
    // 50,000 @ 2.5%/month interest-only for 3 months.
    expect(Money.fromMinorUnits(result.offer!.totalInterestCents).toMajorUnitsString()).toBe("3750.00");
    expect(["UNDER_REVIEW", "RISK_REVIEW"]).toContain(result.application.status);
  });

  it("approves the application", async () => {
    const { application } = await env.container.approvals.approve(
      applicationId,
      { reason: "符合授信條件" },
      ctx(env.users.userIds.MANAGER!)
    );
    expect(application.status).toBe("APPROVED");
  });

  it("creates the loan with an immutable snapshot and a schedule", async () => {
    const loan = await env.container.loans.createFromApprovedApplication(
      applicationId,
      ctx(env.users.userIds.MANAGER!)
    );
    loanId = loan.id;

    expect(loan.status).toBe("READY_FOR_DISBURSEMENT");
    expect(loan.snapshot).not.toBeNull();
    expect(loan.snapshot!.ratePercent).toBe(2.5);
    expect(loan.scheduleLines).toHaveLength(3);
    // Nothing is owed until the money leaves.
    expect(loan.outstandingPrincipalCents).toBe(0);
  });

  it("disburses the loan and opens the balance", async () => {
    const result = await env.container.loans.disburse(
      loanId,
      { idempotencyKey: "test-disburse-1" },
      ctx(env.users.userIds.MANAGER!)
    );

    expect(result.replayed).toBe(false);
    expect(result.disbursement.status).toBe("COMPLETED");
    expect(result.loan.status).toBe("ACTIVE");
    expect(Money.fromMinorUnits(result.loan.outstandingPrincipalCents).toMajorUnitsString()).toBe(
      "50000.00"
    );
    expect(Money.fromMinorUnits(result.loan.outstandingInterestCents).toMajorUnitsString()).toBe(
      "3750.00"
    );
  });

  it("is idempotent on disbursement (§74.5: never disburse twice)", async () => {
    const replay = await env.container.loans.disburse(
      loanId,
      { idempotencyKey: "test-disburse-1" },
      ctx(env.users.userIds.MANAGER!)
    );
    expect(replay.replayed).toBe(true);

    const count = await env.db.disbursement.count({ where: { loanId } });
    expect(count).toBe(1);
  });

  // Spec §58: partial payment.
  it("allocates a partial payment interest-first", async () => {
    env.clock.set(new Date("2026-02-01T09:00:00Z"));

    const { payment } = await env.container.payments.create(
      { loanId, amount: 2000, method: "CASH", idempotencyKey: "test-payment-1" },
      ctx(env.users.userIds.LOAN_OFFICER!)
    );

    const allocation = payment.allocations[0]!;
    expect(Money.fromMinorUnits(allocation.interestAmountCents).toMajorUnitsString()).toBe("2000.00");
    expect(allocation.principalAmountCents).toBe(0);

    const loan = await env.db.loan.findUniqueOrThrow({ where: { id: loanId } });
    expect(Money.fromMinorUnits(loan.outstandingInterestCents).toMajorUnitsString()).toBe("1750.00");
    expect(Money.fromMinorUnits(loan.outstandingPrincipalCents).toMajorUnitsString()).toBe("50000.00");
  });

  it("reproduces the stored balance from the ledger (§24)", async () => {
    const projected = await env.container.loans.recalculateLoanBalance(loanId);
    const loan = await env.db.loan.findUniqueOrThrow({ where: { id: loanId } });

    expect(projected.outstandingPrincipal.toMinorUnits()).toBe(loan.outstandingPrincipalCents);
    expect(projected.outstandingInterest.toMinorUnits()).toBe(loan.outstandingInterestCents);
    expect(projected.outstandingFees.toMinorUnits()).toBe(loan.outstandingFeeCents);
  });

  // Spec §60: drive delinquency with the clock.
  it("stays current while the paid installment covers the period", async () => {
    // The 2,000 payment cleared installment 1 (1,250 interest) outright, so
    // mid-February there is genuinely nothing past due.
    env.clock.set(new Date("2026-02-15T09:00:00Z"));
    const loan = await env.container.loans.refreshDelinquency(
      loanId,
      ctx(env.users.userIds.MANAGER!)
    );
    expect(loan.status).toBe("ACTIVE");
  });

  it("becomes OVERDUE once a part-paid installment passes its due date", async () => {
    // Installment 2 (due 2026-03-01) only received 750 of its 1,250.
    env.clock.set(new Date("2026-03-15T09:00:00Z"));
    const loan = await env.container.loans.refreshDelinquency(
      loanId,
      ctx(env.users.userIds.MANAGER!)
    );
    expect(loan.status).toBe("OVERDUE");
  });

  it("opens a collection case for the overdue loan", async () => {
    const { openedCaseIds } = await env.container.collections.syncCasesForOverdueLoans(
      ctx(env.users.userIds.COLLECTOR!)
    );
    expect(openedCaseIds.length).toBeGreaterThan(0);

    const collectionCase = await env.db.collectionCase.findFirstOrThrow({ where: { loanId } });
    expect(collectionCase.status).toBe("OPEN");
    expect(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).toContain(collectionCase.priority);

    await env.container.collections.addActivity(
      collectionCase.id,
      { type: "PHONE", result: "客戶承諾還款", note: "約定 2/20 還款" },
      ctx(env.users.userIds.COLLECTOR!)
    );
    const updated = await env.db.collectionCase.findUniqueOrThrow({ where: { id: collectionCase.id } });
    expect(updated.status).toBe("IN_PROGRESS");
  });

  // Spec §59: full settlement.
  it("settles the loan when the balance reaches zero", async () => {
    env.clock.set(new Date("2026-04-01T09:00:00Z"));

    const outstanding = await env.container.payments.getOutstanding(loanId);
    const total = outstanding.principal.add(outstanding.interest).add(outstanding.fees);

    await env.container.payments.create(
      {
        loanId,
        amount: total.toMajorUnitsString(),
        method: "BANK_TRANSFER",
        idempotencyKey: "test-payment-settle",
      },
      ctx(env.users.userIds.MANAGER!)
    );

    const loan = await env.db.loan.findUniqueOrThrow({ where: { id: loanId } });
    expect(loan.status).toBe("PAID_OFF");
    expect(loan.outstandingPrincipalCents).toBe(0);
    expect(loan.outstandingInterestCents).toBe(0);

    const settlement = await env.db.settlement.findUniqueOrThrow({ where: { loanId } });
    expect(Money.fromMinorUnits(settlement.totalPaidCents).toMajorUnitsString()).toBe("53750.00");
  });

  it("refuses further payments on a settled loan (§74.14)", async () => {
    await expect(
      env.container.payments.create(
        { loanId, amount: 100, idempotencyKey: "test-payment-after-settle" },
        ctx(env.users.userIds.MANAGER!)
      )
    ).rejects.toThrow(/cannot perform PAYMENT/i);
  });

  it("shows a consistent Customer 360 at the end of the lifecycle", async () => {
    const view = await env.container.customer360.get(customerId);

    expect(view.summary.totalBorrowed).toBe("50000.00");
    expect(view.summary.totalRepaid).toBe("53750.00");
    expect(view.summary.interestPaid).toBe("3750.00");
    expect(view.summary.totalOutstanding).toBe("0.00");
    expect(view.summary.paidOffLoanCount).toBe(1);
    expect(view.summary.activeLoanCount).toBe(0);
    // Identity number must never come back in the clear.
    expect(view.profile.identityNumberMasked).not.toContain("123456");
  });

  it("has an audit trail covering the whole lifecycle (§53)", async () => {
    const { items } = await env.container.audit.list({ take: 200 });
    const actions = items.map((i) => i.action);

    for (const expected of [
      "CUSTOMER_CREATED",
      "APPLICATION_CREATED",
      "APPLICATION_SUBMITTED",
      "RISK_ASSESSMENT_CREATED",
      "LENDING_LIMIT_CALCULATED",
      "LOAN_OFFER_CREATED",
      "APPLICATION_APPROVED",
      "LOAN_CREATED",
      "LOAN_DISBURSED",
      "PAYMENT_CREATED",
      "SETTLEMENT_CREATED",
      "COLLECTION_CASE_CREATED",
    ]) {
      expect(actions, `missing audit action ${expected}`).toContain(expected);
    }
  });
});
