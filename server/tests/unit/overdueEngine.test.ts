import { describe, expect, it } from "vitest";
import { OverdueEngine } from "../../src/modules/loan/domain/overdueEngine.js";
import { MockClock } from "../../src/shared/clock.js";
import { Money } from "../../src/shared/money.js";

const m = (v: number) => Money.fromMajorUnits(v);

const schedule = [
  {
    installmentNumber: 1,
    dueDate: new Date("2026-02-01T00:00:00Z"),
    totalDue: m(1250),
    totalPaid: Money.zero(),
  },
  {
    installmentNumber: 2,
    dueDate: new Date("2026-03-01T00:00:00Z"),
    totalDue: m(1250),
    totalPaid: Money.zero(),
  },
  {
    installmentNumber: 3,
    dueDate: new Date("2026-04-01T00:00:00Z"),
    totalDue: m(51250),
    totalPaid: Money.zero(),
  },
];

describe("OverdueEngine", () => {
  // Spec §60: drive the lifecycle with MockClock, never `new Date()`.
  const clock = new MockClock(new Date("2026-01-01T00:00:00Z"));

  it("is CURRENT well before the first due date", () => {
    clock.set(new Date("2026-01-05T00:00:00Z"));
    const result = OverdueEngine.evaluate({ scheduleLines: schedule, currentDate: clock.now() });
    expect(result.status).toBe("CURRENT");
    expect(result.daysOverdue).toBe(0);
    expect(result.overdueAmount.isZero()).toBe(true);
  });

  it("is DUE_SOON inside the warning window", () => {
    clock.set(new Date("2026-01-28T00:00:00Z"));
    const result = OverdueEngine.evaluate({ scheduleLines: schedule, currentDate: clock.now() });
    expect(result.status).toBe("DUE_SOON");
    expect(result.daysOverdue).toBe(0);
  });

  it("is DUE on the due date itself", () => {
    clock.set(new Date("2026-02-01T00:00:00Z"));
    const result = OverdueEngine.evaluate({ scheduleLines: schedule, currentDate: clock.now() });
    expect(result.status).toBe("DUE");
    expect(result.daysOverdue).toBe(0);
  });

  it("is OVERDUE the day after the due date", () => {
    clock.set(new Date("2026-02-01T00:00:00Z"));
    clock.advanceDays(1);
    const result = OverdueEngine.evaluate({ scheduleLines: schedule, currentDate: clock.now() });
    expect(result.status).toBe("OVERDUE");
    expect(result.daysOverdue).toBe(1);
    expect(result.overdueAmount.toMajorUnitsString()).toBe("1250.00");
    expect(result.overdueInstallments).toEqual([1]);
  });

  it("ages delinquency from the OLDEST unpaid installment", () => {
    clock.set(new Date("2026-02-01T00:00:00Z"));
    clock.advanceDays(30); // 2026-03-03: installments 1 and 2 both unpaid
    const result = OverdueEngine.evaluate({ scheduleLines: schedule, currentDate: clock.now() });
    expect(result.status).toBe("OVERDUE");
    expect(result.daysOverdue).toBe(30);
    expect(result.overdueInstallments).toEqual([1, 2]);
    expect(result.overdueAmount.toMajorUnitsString()).toBe("2500.00");
  });

  it("tracks 60 and 90 day delinquency buckets", () => {
    const base = new Date("2026-02-01T00:00:00Z");
    for (const days of [60, 90]) {
      const clockAt = new MockClock(base);
      clockAt.advanceDays(days);
      const result = OverdueEngine.evaluate({ scheduleLines: schedule, currentDate: clockAt.now() });
      expect(result.daysOverdue).toBe(days);
      expect(result.status).toBe("OVERDUE");
    }
  });

  it("ignores fully paid installments", () => {
    const paidSchedule = schedule.map((line, index) =>
      index === 0 ? { ...line, totalPaid: line.totalDue } : line
    );
    const result = OverdueEngine.evaluate({
      scheduleLines: paidSchedule,
      currentDate: new Date("2026-02-05T00:00:00Z"),
    });
    expect(result.status).toBe("CURRENT");
    expect(result.overdueInstallments).toEqual([]);
  });

  it("still counts a partially paid installment as overdue", () => {
    const partial = schedule.map((line, index) =>
      index === 0 ? { ...line, totalPaid: m(500) } : line
    );
    const result = OverdueEngine.evaluate({
      scheduleLines: partial,
      currentDate: new Date("2026-02-10T00:00:00Z"),
    });
    expect(result.status).toBe("OVERDUE");
    expect(result.overdueAmount.toMajorUnitsString()).toBe("750.00");
  });

  it("maps delinquency onto loan status", () => {
    expect(OverdueEngine.toLoanStatus("CURRENT")).toBe("ACTIVE");
    expect(OverdueEngine.toLoanStatus("DUE_SOON")).toBe("DUE_SOON");
    expect(OverdueEngine.toLoanStatus("DUE")).toBe("DUE");
    expect(OverdueEngine.toLoanStatus("OVERDUE")).toBe("OVERDUE");
  });
});
