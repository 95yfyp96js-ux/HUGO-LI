import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, ctx, TEST_PASSWORD } from "../helpers/testEnv.js";

/**
 * 今日應收: a per-day receivables list read from ScheduleLine.dueDate.
 *
 * The one hard requirement is that switching the viewed date shows only that
 * day's installments — not a running total of everything unpaid up to it —
 * so the core of this file is two loans with different due dates and proof
 * that each date shows exactly one of them.
 */
let env: Awaited<ReturnType<typeof createTestEnv>>;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});

const manager = () => ctx(env.users.userIds.MANAGER!);

async function dailyProduct(overrides: Record<string, unknown> = {}) {
  return env.container.products.create(
    {
      productCode: `DAY-${randomUUID().slice(0, 8)}`,
      name: "短天期單利",
      minAmount: 10000,
      maxAmount: 200000,
      minTermCount: 1,
      maxTermCount: 30,
      termUnit: "DAY",
      ratePercent: 0.1,
      rateUnit: "DAILY",
      repaymentMethod: "BULLET",
      ...overrides,
    } as Parameters<typeof env.container.products.create>[0],
    manager()
  );
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

describe("today's receivables", () => {
  it("shows only the selected day's installments, even with another due date outstanding", async () => {
    const product = await dailyProduct();
    const customer = await env.container.customers.create(
      {
        name: "切日期練習客戶",
        identityNumber: `S${randomUUID().slice(0, 8)}`,
        dateOfBirth: "1990-01-01",
        phone: "0912345678",
        monthlyIncome: 80000,
      },
      ctx(env.users.userIds.LOAN_OFFICER!)
    );
    const app = await env.container.applications.create(
      {
        customerId: customer.id,
        requestedProductId: product.id,
        requestedAmount: 50000,
        requestedTermCount: 3,
        income: 80000,
        existingDebt: 0,
      },
      ctx(env.users.userIds.LOAN_OFFICER!)
    );
    await env.container.applications.submit(app.id, ctx(env.users.userIds.LOAN_OFFICER!));
    await env.container.approvals.approve(app.id, { reason: "ok" }, manager());
    const loanA = await env.container.loans.createFromApprovedApplication(app.id, manager());

    const app2 = await env.container.applications.create(
      {
        customerId: customer.id,
        requestedProductId: product.id,
        requestedAmount: 60000,
        requestedTermCount: 7,
        income: 80000,
        existingDebt: 0,
      },
      ctx(env.users.userIds.LOAN_OFFICER!)
    );
    await env.container.applications.submit(app2.id, ctx(env.users.userIds.LOAN_OFFICER!));
    await env.container.approvals.approve(app2.id, { reason: "ok" }, manager());
    const loanB = await env.container.loans.createFromApprovedApplication(app2.id, manager());

    const dueA = ymd(loanA.maturityDate!);
    const dueB = ymd(loanB.maturityDate!);
    expect(dueA).not.toBe(dueB);

    const onDayA = await env.container.payments.dueOn(dueA);
    expect(onDayA.items.map((i) => i.loanId)).toEqual([loanA.id]);

    const onDayB = await env.container.payments.dueOn(dueB);
    expect(onDayB.items.map((i) => i.loanId)).toEqual([loanB.id]);
  });

  it("labels a past due date as overdue and today's date as due today", async () => {
    const product = await dailyProduct();
    const customer = await env.container.customers.create(
      {
        name: "應收練習客戶",
        identityNumber: `R${randomUUID().slice(0, 8)}`,
        dateOfBirth: "1990-01-01",
        phone: "0912345678",
        monthlyIncome: 80000,
      },
      ctx(env.users.userIds.LOAN_OFFICER!)
    );
    const app = await env.container.applications.create(
      {
        customerId: customer.id,
        requestedProductId: product.id,
        requestedAmount: 30000,
        requestedTermCount: 2,
        income: 80000,
        existingDebt: 0,
      },
      ctx(env.users.userIds.LOAN_OFFICER!)
    );
    await env.container.applications.submit(app.id, ctx(env.users.userIds.LOAN_OFFICER!));
    await env.container.approvals.approve(app.id, { reason: "ok" }, manager());
    const loan = await env.container.loans.createFromApprovedApplication(app.id, manager());
    const dueDate = ymd(loan.maturityDate!);

    // Viewed before it falls due: not overdue.
    const before = await env.container.payments.dueOn(dueDate);
    expect(before.items[0]?.status).toBe("DUE_TODAY");

    // Move the clock past the due date and view the SAME calendar day again.
    env.clock.advanceDays(5);
    const after = await env.container.payments.dueOn(dueDate);
    expect(after.items[0]?.status).toBe("OVERDUE");
  });

  it("drops an installment once it is fully collected", async () => {
    const product = await dailyProduct();
    const customer = await env.container.customers.create(
      {
        name: "已收清客戶",
        identityNumber: `P${randomUUID().slice(0, 8)}`,
        dateOfBirth: "1990-01-01",
        phone: "0912345678",
        monthlyIncome: 80000,
      },
      ctx(env.users.userIds.LOAN_OFFICER!)
    );
    const app = await env.container.applications.create(
      {
        customerId: customer.id,
        requestedProductId: product.id,
        requestedAmount: 20000,
        requestedTermCount: 4,
        income: 80000,
        existingDebt: 0,
      },
      ctx(env.users.userIds.LOAN_OFFICER!)
    );
    await env.container.applications.submit(app.id, ctx(env.users.userIds.LOAN_OFFICER!));
    await env.container.approvals.approve(app.id, { reason: "ok" }, manager());
    const loan = await env.container.loans.createFromApprovedApplication(app.id, manager());
    await env.container.loans.disburse(loan.id, { idempotencyKey: randomUUID() }, manager());
    const dueDate = ymd(loan.maturityDate!);

    const before = await env.container.payments.dueOn(dueDate);
    expect(before.items.some((i) => i.loanId === loan.id)).toBe(true);

    const outstanding = await env.container.payments.getOutstanding(loan.id);
    const total = outstanding.principal.add(outstanding.interest).add(outstanding.fees);
    await env.container.payments.create(
      { loanId: loan.id, amount: total.toMajorUnitsString(), method: "CASH", idempotencyKey: randomUUID() },
      manager()
    );

    const after = await env.container.payments.dueOn(dueDate);
    expect(after.items.some((i) => i.loanId === loan.id)).toBe(false);
  });

  it("is reachable by every role that can read payments, auditor included", async () => {
    const token = await request(env.app)
      .post("/api/auth/login")
      .send({ email: "auditor@test.local", password: TEST_PASSWORD })
      .expect(200)
      .then((r) => r.body.token as string);

    await request(env.app)
      .get("/api/payments/due-today")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
  });
});
