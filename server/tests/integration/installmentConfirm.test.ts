import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestEnv, ctx } from "../helpers/testEnv.js";
import { Money } from "../../src/shared/money.js";

/** Issues and disburses a 3-installment daily interest-only loan slip. */
async function issueThreeInstallmentLoan(env: Awaited<ReturnType<typeof createTestEnv>>) {
  const customer = await env.container.customers.create(
    {
      name: "回款確認測試客戶",
      identityNumber: `E${Math.floor(100000000 + Math.random() * 899999999)}`,
      dateOfBirth: "1990-01-01",
      phone: "0900000001",
      monthlyIncome: 60000,
    },
    ctx(env.users.userIds.LOAN_OFFICER!)
  );

  const { loan } = await env.container.loans.issueLoanSlip(
    {
      customerId: customer.id,
      principal: 30000,
      rateUnit: "DAILY",
      ratePercent: 0.1,
      repaymentMethod: "INTEREST_ONLY",
      interestTiming: "POST_PAID",
      termCount: 3,
      idempotencyKey: `slip-${customer.id}`,
    },
    ctx(env.users.userIds.MANAGER!)
  );

  await env.container.loans.disburse(
    loan.id,
    { idempotencyKey: `disburse-${loan.id}` },
    ctx(env.users.userIds.MANAGER!)
  );

  return { customerId: customer.id, loanId: loan.id };
}

describe("PaymentService.confirmInstallment (回款確認)", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeEach(async () => {
    env = await createTestEnv(new Date("2026-01-01T09:00:00Z"));
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it("clears only the targeted installment, even when an earlier one is still unpaid", async () => {
    const { loanId } = await issueThreeInstallmentLoan(env);

    // Confirm #2 while #1 is still open.
    const { payment } = await env.container.payments.confirmInstallment(
      loanId,
      2,
      { idempotencyKey: "confirm-2-first" },
      ctx(env.users.userIds.MANAGER!)
    );
    expect(payment.status).toBe("CONFIRMED");

    const lines = await env.db.scheduleLine.findMany({
      where: { loanId },
      orderBy: { installmentNumber: "asc" },
    });
    const [line1, line2, line3] = lines;

    expect(line1!.status).toBe("PENDING");
    expect(line1!.principalPaidCents + line1!.interestPaidCents).toBe(0);

    expect(line2!.status).toBe("PAID");
    expect(line2!.interestPaidCents).toBe(line2!.interestDueCents);

    expect(line3!.status).toBe("PENDING");

    // The loan's balance moved by exactly installment #2's amount.
    const loan = await env.db.loan.findUniqueOrThrow({ where: { id: loanId } });
    const expectedInterest =
      line1!.interestDueCents + line3!.interestDueCents; // 30 (day interest) each, #2 already paid
    expect(loan.outstandingInterestCents).toBe(expectedInterest);
  });

  it("does not double-record a repeated Idempotency-Key on the same installment", async () => {
    const { loanId } = await issueThreeInstallmentLoan(env);

    const first = await env.container.payments.confirmInstallment(
      loanId,
      1,
      { idempotencyKey: "confirm-1-replay" },
      ctx(env.users.userIds.MANAGER!)
    );
    expect(first.replayed).toBe(false);

    const second = await env.container.payments.confirmInstallment(
      loanId,
      1,
      { idempotencyKey: "confirm-1-replay" },
      ctx(env.users.userIds.MANAGER!)
    );
    expect(second.replayed).toBe(true);
    expect(second.payment.id).toBe(first.payment.id);

    expect(await env.db.payment.count({ where: { loanId } })).toBe(1);
    const line1 = await env.db.scheduleLine.findFirstOrThrow({ where: { loanId, installmentNumber: 1 } });
    expect(line1.interestPaidCents).toBe(line1.interestDueCents);
    expect(line1.status).toBe("PAID");
  });

  it("refuses a second, differently-keyed confirmation of an already-paid installment", async () => {
    const { loanId } = await issueThreeInstallmentLoan(env);

    await env.container.payments.confirmInstallment(
      loanId,
      1,
      { idempotencyKey: "confirm-1-a" },
      ctx(env.users.userIds.MANAGER!)
    );

    await expect(
      env.container.payments.confirmInstallment(
        loanId,
        1,
        { idempotencyKey: "confirm-1-b" },
        ctx(env.users.userIds.MANAGER!)
      )
    ).rejects.toThrow(/already been confirmed/);

    // Exactly one payment recorded for this installment — no double credit.
    expect(await env.db.payment.count({ where: { loanId } })).toBe(1);
    const line1 = await env.db.scheduleLine.findFirstOrThrow({ where: { loanId, installmentNumber: 1 } });
    expect(line1.interestPaidCents).toBe(line1.interestDueCents);

    const loan = await env.db.loan.findUniqueOrThrow({ where: { id: loanId } });
    const recalculated = await env.container.loans.recalculateLoanBalance(loanId);
    expect(recalculated.outstandingInterest.toMinorUnits()).toBe(loan.outstandingInterestCents);
  });

  it("refuses confirming an installment number that does not exist on the loan", async () => {
    const { loanId } = await issueThreeInstallmentLoan(env);

    await expect(
      env.container.payments.confirmInstallment(
        loanId,
        99,
        { idempotencyKey: "confirm-missing" },
        ctx(env.users.userIds.MANAGER!)
      )
    ).rejects.toThrow(/no such installment/i);
  });

  it("settles the loan once every installment has been confirmed individually", async () => {
    const { loanId } = await issueThreeInstallmentLoan(env);

    for (let n = 1; n <= 3; n++) {
      await env.container.payments.confirmInstallment(
        loanId,
        n,
        { idempotencyKey: `confirm-settle-${n}` },
        ctx(env.users.userIds.MANAGER!)
      );
    }

    const loan = await env.db.loan.findUniqueOrThrow({ where: { id: loanId } });
    expect(loan.status).toBe("PAID_OFF");
    expect(Money.fromMinorUnits(loan.outstandingPrincipalCents).isZero()).toBe(true);
    expect(Money.fromMinorUnits(loan.outstandingInterestCents).isZero()).toBe(true);
  });
});
