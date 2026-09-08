import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestEnv, ctx } from "../helpers/testEnv.js";
import { Money } from "../../src/shared/money.js";

/**
 * 一筆借據一張單 — the freeform loan slip. Every field is filled by hand,
 * a template product is optional, and interest math flows entirely through
 * the unmodified RepaymentEngine/InterestEngine — these tests exist to prove
 * that pipeline reaches the same, correct numbers a hand calculation would.
 */
describe("LoanService.issueLoanSlip", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;
  let customerId: string;

  beforeEach(async () => {
    env = await createTestEnv(new Date("2026-01-01T09:00:00Z"));
    const customer = await env.container.customers.create(
      {
        name: "借據測試客戶",
        identityNumber: `D${Math.floor(100000000 + Math.random() * 899999999)}`,
        dateOfBirth: "1990-01-01",
        phone: "0900000000",
        monthlyIncome: 60000,
      },
      ctx(env.users.userIds.LOAN_OFFICER!)
    );
    customerId = customer.id;
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it("issues a 10-day daily-interest interest-only slip with no template product", async () => {
    const { loan } = await env.container.loans.issueLoanSlip(
      {
        customerId,
        principal: 100000,
        rateUnit: "DAILY",
        ratePercent: 0.1,
        repaymentMethod: "INTEREST_ONLY",
        interestTiming: "POST_PAID",
        termCount: 10,
        idempotencyKey: "slip-10-day-interest-only",
      },
      ctx(env.users.userIds.MANAGER!)
    );

    expect(loan.status).toBe("READY_FOR_DISBURSEMENT");
    expect(loan.productId).toBeNull();
    expect(loan.snapshot?.productId ?? null).toBeNull();
    expect(loan.snapshot?.productVersion ?? null).toBeNull();
    expect(loan.snapshot?.termUnit).toBe("DAY");
    expect(loan.snapshot?.rateUnit).toBe("DAILY");
    expect(loan.snapshot?.interestTiming).toBe("POST_PAID");
    expect(loan.scheduleLines).toHaveLength(10);

    // 100,000 * 0.1% = 100.00 interest every day; principal only at maturity.
    for (const line of loan.scheduleLines.slice(0, 9)) {
      expect(Money.fromMinorUnits(line.interestDueCents).toMajorUnitsString()).toBe("100.00");
      expect(Money.fromMinorUnits(line.principalDueCents).isZero()).toBe(true);
    }
    const last = loan.scheduleLines[9]!;
    expect(Money.fromMinorUnits(last.interestDueCents).toMajorUnitsString()).toBe("100.00");
    expect(Money.fromMinorUnits(last.principalDueCents).toMajorUnitsString()).toBe("100000.00");

    // Due dates are one calendar day apart, not one month.
    expect(loan.scheduleLines[0]!.dueDate.toISOString().slice(0, 10)).toBe("2026-01-02");
    expect(loan.scheduleLines[9]!.dueDate.toISOString().slice(0, 10)).toBe("2026-01-11");

    // Disbursement (the caller's separate next step) loads the full term's
    // interest, same as any other loan.
    const { loan: disbursed } = await env.container.loans.disburse(
      loan.id,
      { idempotencyKey: "disburse-10-day" },
      ctx(env.users.userIds.MANAGER!)
    );
    expect(disbursed.status).toBe("ACTIVE");
    expect(Money.fromMinorUnits(disbursed.outstandingPrincipalCents).toMajorUnitsString()).toBe("100000.00");
    expect(Money.fromMinorUnits(disbursed.outstandingInterestCents).toMajorUnitsString()).toBe("1000.00");
  });

  it("issues a 30-day equal-installment (等額本息) slip that repays every cent with a level payment", async () => {
    const { loan } = await env.container.loans.issueLoanSlip(
      {
        customerId,
        principal: 30000,
        rateUnit: "DAILY",
        ratePercent: 0.1,
        repaymentMethod: "EQUAL_INSTALLMENT",
        interestTiming: "POST_PAID",
        termCount: 30,
        idempotencyKey: "slip-30-day-equal-installment",
      },
      ctx(env.users.userIds.MANAGER!)
    );

    expect(loan.scheduleLines).toHaveLength(30);

    const totalPrincipal = Money.sum(
      loan.scheduleLines.map((l) => Money.fromMinorUnits(l.principalDueCents))
    );
    expect(totalPrincipal.toMajorUnitsString()).toBe("30000.00");

    // Level payment across every installment except the last, which absorbs
    // whatever cent the previous 29 periods' independent roundings drifted by
    // (the same last-installment-absorbs-the-remainder convention the other
    // schedule methods already use) — so it is compared only on being
    // positive and smaller than the final balloon it is not.
    const nonLastTotals = loan.scheduleLines
      .slice(0, 29)
      .map((l) => l.principalDueCents + l.interestDueCents + l.feeDueCents);
    const [first, ...rest] = nonLastTotals;
    for (const total of rest) {
      expect(Math.abs(total - first!)).toBeLessThanOrEqual(1);
    }

    // Interest declines and principal grows as the balance is paid down.
    expect(loan.scheduleLines[0]!.interestDueCents).toBeGreaterThan(loan.scheduleLines[29]!.interestDueCents);
    expect(loan.scheduleLines[29]!.principalDueCents).toBeGreaterThan(loan.scheduleLines[0]!.principalDueCents);

    expect(loan.scheduleLines[29]!.dueDate.toISOString().slice(0, 10)).toBe("2026-01-31");
  });

  it("prefills productId/productVersion onto the snapshot when a template product is given", async () => {
    const { loan } = await env.container.loans.issueLoanSlip(
      {
        customerId,
        templateProductId: env.users.productId,
        principal: 50000,
        rateUnit: "MONTHLY",
        ratePercent: 2.5,
        repaymentMethod: "BULLET",
        interestTiming: "POST_PAID",
        termCount: 3,
        idempotencyKey: "slip-with-template",
      },
      ctx(env.users.userIds.MANAGER!)
    );

    expect(loan.productId).toBe(env.users.productId);
    expect(loan.snapshot?.productId).toBe(env.users.productId);
    expect(loan.snapshot?.productVersion).toBe(1);
  });

  it("derives termCount from an explicit maturity date when termCount is omitted", async () => {
    const { loan } = await env.container.loans.issueLoanSlip(
      {
        customerId,
        principal: 20000,
        rateUnit: "DAILY",
        ratePercent: 0.2,
        repaymentMethod: "BULLET",
        interestTiming: "POST_PAID",
        disbursedAt: "2026-01-01T09:00:00.000Z",
        maturityDate: "2026-01-08T09:00:00.000Z",
        idempotencyKey: "slip-maturity-date",
      },
      ctx(env.users.userIds.MANAGER!)
    );

    expect(loan.snapshot?.termCount).toBe(7);
    expect(loan.scheduleLines).toHaveLength(1);
  });

  it("refuses PRE_PAID interest timing rather than silently treating it as POST_PAID", async () => {
    await expect(
      env.container.loans.issueLoanSlip(
        {
          customerId,
          principal: 10000,
          rateUnit: "DAILY",
          ratePercent: 0.1,
          repaymentMethod: "BULLET",
          interestTiming: "PRE_PAID",
          termCount: 10,
          idempotencyKey: "slip-pre-paid",
        },
        ctx(env.users.userIds.MANAGER!)
      )
    ).rejects.toThrow(/先收息/);

    expect(await env.db.loan.count()).toBe(0);
  });

  it("requires either termCount or maturityDate", async () => {
    await expect(
      env.container.loans.issueLoanSlip(
        {
          customerId,
          principal: 10000,
          rateUnit: "DAILY",
          ratePercent: 0.1,
          repaymentMethod: "BULLET",
          interestTiming: "POST_PAID",
          idempotencyKey: "slip-no-term",
        },
        ctx(env.users.userIds.MANAGER!)
      )
    ).rejects.toThrow(/到期日或天數/);
  });

  it("enforces the shop-wide rate cap exactly like the product and approval paths", async () => {
    await env.container.shopSettings.setRateCap(3, ctx(env.users.userIds.MANAGER!));

    // 0.2%/day is a 6%/month equivalent, over the 3% cap.
    await expect(
      env.container.loans.issueLoanSlip(
        {
          customerId,
          principal: 10000,
          rateUnit: "DAILY",
          ratePercent: 0.2,
          repaymentMethod: "BULLET",
          interestTiming: "POST_PAID",
          termCount: 10,
          idempotencyKey: "slip-over-cap",
        },
        ctx(env.users.userIds.MANAGER!)
      )
    ).rejects.toMatchObject({ code: "RATE_CAP_EXCEEDED" });

    expect(await env.db.loan.count()).toBe(0);
  });

  it("replays the same loan on a repeated Idempotency-Key instead of issuing a second one", async () => {
    const first = await env.container.loans.issueLoanSlip(
      {
        customerId,
        principal: 10000,
        rateUnit: "DAILY",
        ratePercent: 0.1,
        repaymentMethod: "BULLET",
        interestTiming: "POST_PAID",
        termCount: 5,
        idempotencyKey: "slip-replay",
      },
      ctx(env.users.userIds.MANAGER!)
    );
    expect(first.replayed).toBe(false);

    const second = await env.container.loans.issueLoanSlip(
      {
        customerId,
        principal: 10000,
        rateUnit: "DAILY",
        ratePercent: 0.1,
        repaymentMethod: "BULLET",
        interestTiming: "POST_PAID",
        termCount: 5,
        idempotencyKey: "slip-replay",
      },
      ctx(env.users.userIds.MANAGER!)
    );
    expect(second.replayed).toBe(true);
    expect(second.loan.id).toBe(first.loan.id);
    expect(await env.db.loan.count({ where: { customerId } })).toBe(1);
  });
});
