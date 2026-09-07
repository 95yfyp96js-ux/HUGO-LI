import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, ctx } from "../helpers/testEnv.js";
import { Money } from "../../src/shared/money.js";
import { RepaymentEngine, periodRate } from "../../src/modules/repayment/domain/repaymentEngine.js";
import request from "supertest";
import { TEST_PASSWORD } from "../helpers/testEnv.js";

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

  it("refuses a second product under a code already in use", async () => {
    const code = `DAY-${randomUUID().slice(0, 8)}`;
    await dailyProduct({ productCode: code });
    await expect(dailyProduct({ productCode: code })).rejects.toThrow(/already exists/);
  });
});

describe("manager creates a product over the real API", () => {
  async function login(role: string) {
    const response = await request(env.app)
      .post("/api/auth/login")
      .send({ email: `${role.toLowerCase()}@test.local`, password: TEST_PASSWORD })
      .expect(200);
    return response.body.token as string;
  }

  it("lets a manager create a new product through the HTTP route", async () => {
    const token = await login("MANAGER");
    const code = `DAY-${randomUUID().slice(0, 8)}`;

    const created = await request(env.app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({
        productCode: code,
        name: "經理新增的短天期商品",
        minAmount: 10000,
        maxAmount: 200000,
        minTermCount: 7,
        maxTermCount: 30,
        termUnit: "DAY",
        ratePercent: 0.1,
        rateUnit: "DAILY",
        repaymentMethod: "BULLET",
      })
      .expect(201);
    expect(created.body.productCode).toBe(code);
    expect(created.body.version).toBe(1);
  });

  it("still forbids a loan officer from creating a product", async () => {
    const token = await login("LOAN_OFFICER");
    const response = await request(env.app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({
        productCode: `DAY-${randomUUID().slice(0, 8)}`,
        name: "不該成功",
        minAmount: 10000,
        maxAmount: 200000,
        minTermCount: 7,
        maxTermCount: 30,
        ratePercent: 0.1,
        rateUnit: "DAILY",
        repaymentMethod: "BULLET",
      })
      .expect(403);
    expect(response.body.code).toBe("INSUFFICIENT_PERMISSION");
  });

  it("lets a manager edit amount, term range, term unit and repayment method together — creating one new version", async () => {
    const token = await login("MANAGER");
    const product = await dailyProduct();

    const updated = await request(env.app)
      .patch(`/api/products/${product.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        maxAmount: 250000,
        minTermCount: 5,
        maxTermCount: 45,
        repaymentMethod: "INTEREST_ONLY",
      })
      .expect(200);

    expect(updated.body.version).toBe(2);
    expect(updated.body.id).not.toBe(product.id);
    // The PATCH route returns the raw stored row (minor units), matching what
    // the existing rate-only edit already relied on; the formatted major-unit
    // view comes from GET, exercised below via the detail fetch.
    expect(updated.body.maxAmountCents).toBe(Money.fromMajorUnits(250000).toMinorUnits());
    expect(updated.body.minTermCount).toBe(5);
    expect(updated.body.maxTermCount).toBe(45);
    expect(updated.body.repaymentMethod).toBe("INTEREST_ONLY");

    const fetched = await request(env.app)
      .get(`/api/products/${updated.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(fetched.body.maxAmount).toBe("250000.00");

    const original = await env.db.loanProduct.findUniqueOrThrow({ where: { id: product.id } });
    expect(original.status).toBe("ARCHIVED");
    expect(original.maxAmountCents).toBe(Money.fromMajorUnits(200000).toMinorUnits());
  });

  it("does not reprice an existing monthly loan when a new daily product is created", async () => {
    const monthly = await env.container.products.list({ status: "ACTIVE" });
    const monthlyProduct = monthly.find((p) => p.rateUnit === "MONTHLY")!;
    const before = { ...monthlyProduct };

    await dailyProduct();

    const after = await env.db.loanProduct.findUniqueOrThrow({ where: { id: monthlyProduct.id } });
    expect(after.ratePercent).toBe(before.ratePercent);
    expect(after.version).toBe(before.version);
    expect(after.status).toBe(before.status);
  });
});
