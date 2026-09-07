import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, ctx } from "../helpers/testEnv.js";
import { Money } from "../../src/shared/money.js";
import { RepaymentEngine, periodRate } from "../../src/modules/repayment/domain/repaymentEngine.js";

let env: Awaited<ReturnType<typeof createTestEnv>>;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});

const admin = () => ctx(env.users.userIds.ADMIN!);

async function dailyProduct(overrides: Record<string, unknown> = {}) {
  return env.container.products.create(
    {
      productCode: `DAY-${randomUUID().slice(0, 8)}`,
      name: "短天期單利",
      minAmount: 10000,
      maxAmount: 200000,
      minTermCount: 7,
      maxTermCount: 30,
      termUnit: "DAY",
      ratePercent: 0.1,
      rateUnit: "DAILY",
      repaymentMethod: "BULLET",
      ...overrides,
    } as Parameters<typeof env.container.products.create>[0],
    admin()
  );
}

describe("term units", () => {
  it("prices a 7-day loan at the daily rate for seven days", () => {
    const schedule = RepaymentEngine.generateSchedule({
      principal: Money.fromMajorUnits(100000),
      ratePercent: 0.1,
      rateUnit: "DAILY",
      termCount: 7,
      termUnit: "DAY",
      startDate: new Date("2026-03-01T00:00:00Z"),
      repaymentMethod: "BULLET",
    });

    // 100,000 x 0.1% x 7 = 700. One payment, seven days out.
    expect(schedule.installments).toHaveLength(1);
    expect(schedule.totalInterest.toMajorUnitsString()).toBe("700.00");
    expect(schedule.installments[0]!.dueDate.toISOString().slice(0, 10)).toBe("2026-03-08");
  });

  it("leaves the monthly path untouched", () => {
    // The canonical monthly product, priced with no unit arguments at all —
    // exactly how every caller wrote it before day terms existed.
    const before = RepaymentEngine.generateSchedule({
      principal: Money.fromMajorUnits(50000),
      ratePercent: 2.5,
      termCount: 3,
      startDate: new Date("2026-01-01T00:00:00Z"),
      repaymentMethod: "INTEREST_ONLY",
    });
    const after = RepaymentEngine.generateSchedule({
      principal: Money.fromMajorUnits(50000),
      ratePercent: 2.5,
      rateUnit: "MONTHLY",
      termCount: 3,
      termUnit: "MONTH",
      startDate: new Date("2026-01-01T00:00:00Z"),
      repaymentMethod: "INTEREST_ONLY",
    });
    expect(after.totalInterest.toMinorUnits()).toBe(before.totalInterest.toMinorUnits());
    expect(before.totalInterest.toMajorUnitsString()).toBe("3750.00");
  });

  it("converts an annual rate to the period actually being charged", () => {
    // The bug this guards: an annual rate applied unconverted to each monthly
    // installment charges twelve times the agreed price.
    expect(periodRate(12, "ANNUAL", "MONTH")).toBeCloseTo(1, 10);
    expect(periodRate(36.5, "ANNUAL", "DAY")).toBeCloseTo(0.1, 10);
    expect(periodRate(0.1, "DAILY", "DAY")).toBeCloseTo(0.1, 10);
    expect(periodRate(2.5, "MONTHLY", "MONTH")).toBe(2.5);
    expect(periodRate(3, "MONTHLY", "DAY")).toBeCloseTo(0.1, 10);
  });

  it("runs a day-term loan through the real origination path", async () => {
    const product = await dailyProduct();
    const customer = await env.container.customers.create(
      {
        name: "日息練習客戶",
        identityNumber: `D${randomUUID().slice(0, 8)}`,
        dateOfBirth: "1990-01-01",
        phone: "0912345678",
        monthlyIncome: 80000,
      },
      ctx(env.users.userIds.LOAN_OFFICER!)
    );

    const application = await env.container.applications.create(
      {
        customerId: customer.id,
        requestedProductId: product.id,
        requestedAmount: 100000,
        requestedTermCount: 7,
        income: 80000,
        existingDebt: 0,
      },
      ctx(env.users.userIds.LOAN_OFFICER!)
    );
    await env.container.applications.submit(application.id, ctx(env.users.userIds.LOAN_OFFICER!));
    await env.container.approvals.approve(
      application.id,
      { reason: "ok" },
      ctx(env.users.userIds.MANAGER!)
    );
    const loan = await env.container.loans.createFromApprovedApplication(
      application.id,
      ctx(env.users.userIds.MANAGER!)
    );

    const stored = await env.db.loan.findUniqueOrThrow({
      where: { id: loan.id },
      include: { snapshot: true, scheduleLines: true },
    });

    expect(stored.snapshot?.termUnit).toBe("DAY");
    expect(stored.snapshot?.termCount).toBe(7);
    expect(stored.scheduleLines).toHaveLength(1);

    // Seven days, not seven months.
    const days = Math.round((+stored.maturityDate! - +stored.startDate!) / 86_400_000);
    expect(days).toBe(7);
  });

  it("refuses an application outside the product's published limits", async () => {
    const product = await dailyProduct();
    const customer = await env.container.customers.create(
      {
        name: "超限客戶",
        identityNumber: `X${randomUUID().slice(0, 8)}`,
        dateOfBirth: "1990-01-01",
        phone: "0912345678",
        monthlyIncome: 80000,
      },
      ctx(env.users.userIds.LOAN_OFFICER!)
    );
    const base = { customerId: customer.id, requestedProductId: product.id, income: 80000, existingDebt: 0 };

    await expect(
      env.container.applications.create(
        { ...base, requestedAmount: 500000, requestedTermCount: 7 },
        ctx(env.users.userIds.LOAN_OFFICER!)
      )
    ).rejects.toThrow(/amount is outside/i);

    await expect(
      env.container.applications.create(
        { ...base, requestedAmount: 100000, requestedTermCount: 60 },
        ctx(env.users.userIds.LOAN_OFFICER!)
      )
    ).rejects.toThrow(/term is outside/i);
  });
});

describe("product versioning", () => {
  it("versions the product when the amount or term limits move", async () => {
    const product = await dailyProduct();

    const widened = await env.container.products.update(
      product.id,
      { maxAmount: 300000 },
      admin()
    );
    expect(widened.version).toBe(2);
    expect(widened.id).not.toBe(product.id);

    const retermed = await env.container.products.update(
      widened.id,
      { maxTermCount: 45 },
      admin()
    );
    expect(retermed.version).toBe(3);

    const reunited = await env.container.products.update(
      retermed.id,
      { termUnit: "MONTH" },
      admin()
    );
    expect(reunited.version).toBe(4);

    // The superseded versions are archived, not edited.
    const original = await env.db.loanProduct.findUniqueOrThrow({ where: { id: product.id } });
    expect(original.status).toBe("ARCHIVED");
    expect(original.maxAmountCents).toBe(Money.fromMajorUnits(200000).toMinorUnits());
    expect(original.maxTermCount).toBe(30);
    expect(original.termUnit).toBe("DAY");
  });

  it("edits presentation in place without a new version", async () => {
    const product = await dailyProduct();
    const renamed = await env.container.products.update(
      product.id,
      { name: "短天期單利（練習）", description: "改個說明" },
      admin()
    );
    expect(renamed.id).toBe(product.id);
    expect(renamed.version).toBe(1);
  });

  it("never repricing an existing loan when the product changes", async () => {
    const product = await dailyProduct();
    const customer = await env.container.customers.create(
      {
        name: "既有貸款客戶",
        identityNumber: `E${randomUUID().slice(0, 8)}`,
        dateOfBirth: "1990-01-01",
        phone: "0912345678",
        monthlyIncome: 80000,
      },
      ctx(env.users.userIds.LOAN_OFFICER!)
    );
    const application = await env.container.applications.create(
      {
        customerId: customer.id,
        requestedProductId: product.id,
        requestedAmount: 100000,
        requestedTermCount: 7,
        income: 80000,
        existingDebt: 0,
      },
      ctx(env.users.userIds.LOAN_OFFICER!)
    );
    await env.container.applications.submit(application.id, ctx(env.users.userIds.LOAN_OFFICER!));
    await env.container.approvals.approve(application.id, { reason: "ok" }, ctx(env.users.userIds.MANAGER!));
    const loan = await env.container.loans.createFromApprovedApplication(
      application.id,
      ctx(env.users.userIds.MANAGER!)
    );
    const before = await env.db.loanSnapshot.findUniqueOrThrow({ where: { loanId: loan.id } });

    // Triple the rate on the product the loan was written against.
    await env.container.products.update(product.id, { ratePercent: 0.3 }, admin());

    const after = await env.db.loanSnapshot.findUniqueOrThrow({ where: { loanId: loan.id } });
    expect(after.ratePercent).toBe(before.ratePercent);
    expect(after.ratePercent).toBe(0.1);
    expect(after.termCount).toBe(before.termCount);
    expect(after.termUnit).toBe(before.termUnit);
  });

  it("offers simple interest only", async () => {
    await expect(dailyProduct({ calculationMethod: "COMPOUND" })).rejects.toThrow(/SIMPLE_INTEREST/);
  });
});
