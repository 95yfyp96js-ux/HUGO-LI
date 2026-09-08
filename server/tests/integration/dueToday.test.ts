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

  it("excludes an installment already fully paid off before its due date arrives", async () => {
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

    // Paid off here, at the clock's current (pre-due-date) moment — this is
    // an early full settlement, collected before the installment's own due
    // date has even arrived.
    const outstanding = await env.container.payments.getOutstanding(loan.id);
    const total = outstanding.principal.add(outstanding.interest).add(outstanding.fees);
    await env.container.payments.create(
      { loanId: loan.id, amount: total.toMajorUnitsString(), method: "CASH", idempotencyKey: randomUUID() },
      manager()
    );

    // By the time its due date's day actually starts, it was already fully
    // collected on an earlier day — so it is not that day's open item.
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

describe("daily close: locked 應收/實收/未收 formulas (Asia/Taipei)", () => {
  /**
   * One fixed moment, well inside a Taipei day (09:00 UTC = 17:00 Taipei),
   * used to originate every loan in this block. Day-term BULLET loans add
   * whole days at that same hour, so each loan's due date lands
   * unambiguously on a known Taipei calendar day with no boundary risk —
   * the boundary itself gets its own dedicated test below.
   */
  const ORIGIN = new Date("2026-03-01T09:00:00.000Z");

  async function originateBulletLoan(product: Awaited<ReturnType<typeof dailyProduct>>, termDays: number) {
    env.clock.set(ORIGIN);
    const customer = await env.container.customers.create(
      {
        name: "日結練習客戶",
        identityNumber: `C${randomUUID().slice(0, 10)}`,
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
        requestedTermCount: termDays,
        income: 80000,
        existingDebt: 0,
      },
      ctx(env.users.userIds.LOAN_OFFICER!)
    );
    await env.container.applications.submit(app.id, ctx(env.users.userIds.LOAN_OFFICER!));
    await env.container.approvals.approve(app.id, { reason: "ok" }, manager());
    const loan = await env.container.loans.createFromApprovedApplication(app.id, manager());
    await env.container.loans.disburse(loan.id, { idempotencyKey: randomUUID() }, manager());
    return loan;
  }

  async function payInFull(loanId: string, paidAt: string) {
    const outstanding = await env.container.payments.getOutstanding(loanId);
    const total = outstanding.principal.add(outstanding.interest).add(outstanding.fees);
    return env.container.payments.create(
      { loanId, amount: total.toMajorUnitsString(), method: "CASH", paidAt, idempotencyKey: randomUUID() },
      manager()
    );
  }

  it("golden case 1: due today, unpaid — appears only in 應收", async () => {
    const product = await dailyProduct();
    const loan = await originateBulletLoan(product, 9); // due 2026-03-10
    const dueDate = ymd(loan.maturityDate!);
    expect(dueDate).toBe("2026-03-10");

    const close = await env.container.payments.dueOn(dueDate);
    const row = close.items.find((i) => i.loanId === loan.id);
    expect(row).toBeDefined();
    expect(row!.collectedToday).toBe("0.00");
    expect(row!.uncollected).toBe(row!.dueAmount);
  });

  it("golden case 2: due today, paid in full today — visible in both 應收 and 實收, 未收 0", async () => {
    const product = await dailyProduct();
    const loan = await originateBulletLoan(product, 9); // due 2026-03-10
    const dueDate = ymd(loan.maturityDate!);
    expect(dueDate).toBe("2026-03-10");

    await payInFull(loan.id, "2026-03-10T04:00:00.000Z"); // 12:00 Taipei, same calendar day

    const close = await env.container.payments.dueOn(dueDate);
    const row = close.items.find((i) => i.loanId === loan.id);
    expect(row).toBeDefined();
    expect(row!.collectedToday).toBe(row!.dueAmount);
    expect(row!.uncollected).toBe("0.00");
    expect(close.summary.collectedCount).toBeGreaterThanOrEqual(1);
  });

  it("golden case 3: due yesterday, paid today — counts in today's 實收, not today's 應收; yesterday's close stays uncollected", async () => {
    const product = await dailyProduct();
    const loan = await originateBulletLoan(product, 8); // due 2026-03-09
    const dueDateYesterday = ymd(loan.maturityDate!);
    expect(dueDateYesterday).toBe("2026-03-09");
    const today = "2026-03-10";

    await payInFull(loan.id, "2026-03-10T04:00:00.000Z"); // paid a day late

    const todayClose = await env.container.payments.dueOn(today);
    expect(todayClose.items.some((i) => i.loanId === loan.id)).toBe(false);
    // The payment still happened today — it just was not aimed at anything
    // due today, so it shows up only in the day's total collections.
    expect(todayClose.summary.collectedCount).toBeGreaterThanOrEqual(1);

    const yesterdayClose = await env.container.payments.dueOn(dueDateYesterday);
    const row = yesterdayClose.items.find((i) => i.loanId === loan.id);
    expect(row).toBeDefined();
    expect(row!.collectedToday).toBe("0.00");
    expect(row!.uncollected).toBe(row!.dueAmount);
  });

  it("golden case 4: paid and reversed the same day — 實收 is credited back", async () => {
    const product = await dailyProduct();
    const loan = await originateBulletLoan(product, 9); // due 2026-03-10
    const dueDate = ymd(loan.maturityDate!);

    const payment = await payInFull(loan.id, "2026-03-10T04:00:00.000Z");
    const withPayment = await env.container.payments.dueOn(dueDate);
    const rowWithPayment = withPayment.items.find((i) => i.loanId === loan.id)!;
    expect(rowWithPayment.uncollected).toBe("0.00");
    const collectedAmountBefore = Number(withPayment.summary.collectedAmount);
    const paidAmount = Number(rowWithPayment.dueAmount);

    await env.container.payments.reverse(payment.payment.id, "誤植", manager());

    const afterReversal = await env.container.payments.dueOn(dueDate);
    const rowAfter = afterReversal.items.find((i) => i.loanId === loan.id)!;
    expect(rowAfter.collectedToday).toBe("0.00");
    expect(rowAfter.uncollected).toBe(rowAfter.dueAmount);
    // The reversed payment no longer counts toward the day's realised cash —
    // checked as a delta, since other tests in this file also collect money
    // on this same calendar day and share this database.
    expect(Number(afterReversal.summary.collectedAmount)).toBeCloseTo(
      collectedAmountBefore - paidAmount,
      6
    );
  });

  it("buckets a due date by its Asia/Taipei calendar day, not its UTC one", async () => {
    const product = await dailyProduct();
    const loan = await originateBulletLoan(product, 9);

    // The maturity date lands at 2026-03-10T09:00:00Z — 17:00 in Taipei, so
    // both calendars agree it is March 10th. Move it to 2026-03-10T17:30:00Z
    // instead: that is 01:30 on March 11th in Taipei, a day UTC would still
    // call the 10th. Only a Taipei-aware query should find it on the 11th.
    const line = await env.db.scheduleLine.findFirstOrThrow({ where: { loanId: loan.id } });
    const boundaryDueDate = new Date("2026-03-10T17:30:00.000Z");
    await env.db.scheduleLine.update({ where: { id: line.id }, data: { dueDate: boundaryDueDate } });
    await env.db.loan.update({ where: { id: loan.id }, data: { maturityDate: boundaryDueDate } });

    const utcDay = await env.container.payments.dueOn("2026-03-10");
    expect(utcDay.items.some((i) => i.loanId === loan.id)).toBe(false);

    const taipeiDay = await env.container.payments.dueOn("2026-03-11");
    expect(taipeiDay.items.some((i) => i.loanId === loan.id)).toBe(true);
  });

  it("feeds the dashboard's 早會 numbers from the exact same calculation", async () => {
    const product = await dailyProduct();
    const loan = await originateBulletLoan(product, 9); // due 2026-03-10
    await payInFull(loan.id, "2026-03-10T04:00:00.000Z");

    // "today" per the injected Clock, not wall-clock reality — the dashboard
    // and the day-close endpoint must agree because they share one Clock and
    // one implementation.
    env.clock.set(new Date("2026-03-10T09:00:00.000Z"));
    const directClose = await env.container.payments.dueOn();

    const token = await request(env.app)
      .post("/api/auth/login")
      .send({ email: "manager@test.local", password: TEST_PASSWORD })
      .expect(200)
      .then((r) => r.body.token as string);
    const dashboard = await request(env.app)
      .get("/api/dashboard")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(dashboard.body.dailyClose.date).toBe(directClose.date);
    expect(dashboard.body.dailyClose.dueCount).toBe(directClose.summary.dueCount);
    expect(dashboard.body.dailyClose.collectedAmount).toBe(directClose.summary.collectedAmount);
    expect(dashboard.body.summary.disbursingCount).toBeDefined();
  });
});
