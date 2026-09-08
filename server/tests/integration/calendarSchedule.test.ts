import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestEnv, ctx } from "../helpers/testEnv.js";

/**
 * 月曆與日程表人數一致 — the calendar's per-day counts must always agree
 * with what the collection schedule shows for that same day, because
 * PaymentService.calendarSummary is built by calling
 * PaymentService.unpaidInstallments for each day rather than a separately
 * maintained aggregate. These tests exercise both endpoints together and
 * check every day, not just a hand-picked one.
 */
describe("Calendar and collection schedule stay consistent", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeEach(async () => {
    env = await createTestEnv(new Date("2026-01-01T09:00:00Z"));
  });

  afterEach(async () => {
    await env.cleanup();
  });

  async function newCustomer(tag: string) {
    return env.container.customers.create(
      {
        name: `月曆測試客戶-${tag}`,
        identityNumber: `F${Math.floor(100000000 + Math.random() * 899999999)}`,
        dateOfBirth: "1990-01-01",
        phone: "0900000002",
        monthlyIncome: 60000,
      },
      ctx(env.users.userIds.LOAN_OFFICER!)
    );
  }

  async function issueAndDisburse(
    tag: string,
    termCount: number,
    repaymentMethod: "INTEREST_ONLY" | "BULLET" = "INTEREST_ONLY"
  ) {
    const customer = await newCustomer(tag);
    const { loan } = await env.container.loans.issueLoanSlip(
      {
        customerId: customer.id,
        principal: 10000,
        rateUnit: "DAILY",
        ratePercent: 0.1,
        repaymentMethod,
        interestTiming: "POST_PAID",
        termCount,
        idempotencyKey: `cal-slip-${tag}`,
      },
      ctx(env.users.userIds.MANAGER!)
    );
    await env.container.loans.disburse(
      loan.id,
      { idempotencyKey: `cal-disburse-${tag}` },
      ctx(env.users.userIds.MANAGER!)
    );
    return loan.id;
  }

  async function assertCalendarMatchesSchedule(month: string) {
    const calendar = await env.container.payments.calendarSummary(month);
    for (const day of calendar.days) {
      const daySchedule = await env.container.payments.unpaidInstallments({ from: day.date, to: day.date });
      expect(daySchedule.items).toHaveLength(day.count);
    }
    // And nothing outside the calendar's day list has any items either.
    const [year, monthNum] = month.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(year!, monthNum!, 0)).getUTCDate();
    const listedDates = new Set(calendar.days.map((d) => d.date));
    for (let day = 1; day <= daysInMonth; day++) {
      const label = `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (listedDates.has(label)) continue;
      const daySchedule = await env.container.payments.unpaidInstallments({ from: label, to: label });
      expect(daySchedule.items).toHaveLength(0);
    }
  }

  it("agrees on every day's count across a month with several loans", async () => {
    // Loan A: 5 daily installments, due 2026-01-02 .. 2026-01-06.
    await issueAndDisburse("A", 5);
    // Loan B: a single BULLET installment landing on the same day as loan A's #2 (01-03).
    await issueAndDisburse("B", 2, "BULLET");

    await assertCalendarMatchesSchedule("2026-01");

    const wholeMonth = await env.container.payments.unpaidInstallments({ from: "2026-01-01", to: "2026-01-31" });
    const calendar = await env.container.payments.calendarSummary("2026-01");
    const totalFromCalendar = calendar.days.reduce((sum, d) => sum + d.count, 0);
    expect(totalFromCalendar).toBe(wholeMonth.items.length);

    // 2026-01-03 specifically should show 2 items (loan A's day-2 installment
    // and loan B's only, final installment).
    const jan3 = calendar.days.find((d) => d.date === "2026-01-03");
    expect(jan3?.count).toBe(2);
  });

  it("keeps the calendar and schedule in agreement after an installment is confirmed", async () => {
    const loanId = await issueAndDisburse("C", 3);

    const before = await env.container.payments.calendarSummary("2026-01");
    const beforeDay = before.days.find((d) => d.date === "2026-01-02");
    expect(beforeDay?.count).toBe(1);

    await env.container.payments.confirmInstallment(
      loanId,
      1,
      { idempotencyKey: "cal-confirm-1" },
      ctx(env.users.userIds.MANAGER!)
    );

    await assertCalendarMatchesSchedule("2026-01");

    const after = await env.container.payments.calendarSummary("2026-01");
    const afterDay = after.days.find((d) => d.date === "2026-01-02");
    // The confirmed installment's day now has nothing outstanding, so it no
    // longer appears in the calendar at all.
    expect(afterDay).toBeUndefined();

    const scheduleForThatDay = await env.container.payments.unpaidInstallments({
      from: "2026-01-02",
      to: "2026-01-02",
    });
    expect(scheduleForThatDay.items).toHaveLength(0);
  });

  it("labels installment status as OVERDUE, DUE_TODAY or UPCOMING consistently with the clock", async () => {
    await issueAndDisburse("D", 3); // due 2026-01-02, 03, 04

    env.clock.set(new Date("2026-01-03T09:00:00Z")); // Taipei day 2026-01-03

    const range = await env.container.payments.unpaidInstallments({ from: "2026-01-01", to: "2026-01-31" });
    const byDate = new Map(range.items.map((i) => [i.dueDate.toISOString().slice(0, 10), i.status]));

    expect(byDate.get("2026-01-02")).toBe("OVERDUE");
    expect(byDate.get("2026-01-03")).toBe("DUE_TODAY");
    expect(byDate.get("2026-01-04")).toBe("UPCOMING");
  });
});
