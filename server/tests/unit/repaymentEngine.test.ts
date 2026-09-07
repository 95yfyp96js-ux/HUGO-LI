import { describe, expect, it } from "vitest";
import { RepaymentEngine } from "../../src/modules/repayment/domain/repaymentEngine.js";
import { InterestEngine } from "../../src/modules/repayment/domain/interestEngine.js";
import { Money } from "../../src/shared/money.js";

const START = new Date("2026-01-01T00:00:00Z");

describe("RepaymentEngine", () => {
  // Spec §57: the schedule for the canonical loan.
  describe("50,000 @ 2.5%/month for 3 months, INTEREST_ONLY", () => {
    const schedule = RepaymentEngine.generateSchedule({
      principal: Money.fromMajorUnits(50000),
      ratePercent: 2.5,
      termCount: 3,
      startDate: START,
      repaymentMethod: "INTEREST_ONLY",
    });

    it("produces one installment per month of the term", () => {
      expect(schedule.installments).toHaveLength(3);
      expect(schedule.installments.map((i) => i.installmentNumber)).toEqual([1, 2, 3]);
    });

    it("charges 1,250 interest every month", () => {
      for (const installment of schedule.installments) {
        expect(installment.interestDue.toMajorUnitsString()).toBe("1250.00");
      }
    });

    it("repays all principal in the final installment", () => {
      expect(schedule.installments[0]!.principalDue.isZero()).toBe(true);
      expect(schedule.installments[1]!.principalDue.isZero()).toBe(true);
      expect(schedule.installments[2]!.principalDue.toMajorUnitsString()).toBe("50000.00");
    });

    it("totals 3,750 interest and 53,750 payable", () => {
      expect(schedule.totalInterest.toMajorUnitsString()).toBe("3750.00");
      expect(schedule.totalPrincipal.toMajorUnitsString()).toBe("50000.00");
      expect(schedule.totalPayable.toMajorUnitsString()).toBe("53750.00");
    });

    it("agrees with InterestEngine on the same loan", () => {
      // The two engines must never disagree about the cost of one loan.
      const viaInterestEngine = InterestEngine.calculate({
        principal: Money.fromMajorUnits(50000),
        ratePercent: 2.5,
        rateUnit: "MONTHLY",
        startDate: START,
        endDate: new Date("2026-04-01T00:00:00Z"),
        calculationMethod: "SIMPLE_INTEREST",
      });
      expect(schedule.totalInterest.equals(viaInterestEngine.interest)).toBe(true);
    });

    it("schedules due dates one month apart", () => {
      expect(schedule.installments[0]!.dueDate.toISOString().slice(0, 10)).toBe("2026-02-01");
      expect(schedule.installments[1]!.dueDate.toISOString().slice(0, 10)).toBe("2026-03-01");
      expect(schedule.installments[2]!.dueDate.toISOString().slice(0, 10)).toBe("2026-04-01");
    });
  });

  describe("PRINCIPAL_AND_INTEREST", () => {
    const schedule = RepaymentEngine.generateSchedule({
      principal: Money.fromMajorUnits(50000),
      ratePercent: 2.5,
      termCount: 3,
      startDate: START,
      repaymentMethod: "PRINCIPAL_AND_INTEREST",
    });

    it("repays the full principal across the term with no cent lost to rounding", () => {
      expect(schedule.totalPrincipal.toMajorUnitsString()).toBe("50000.00");
    });

    it("charges interest on the declining balance", () => {
      const [first, second, third] = schedule.installments;
      expect(first!.interestDue.toMajorUnitsString()).toBe("1250.00");
      expect(second!.interestDue.greaterThan(third!.interestDue)).toBe(true);
      expect(first!.interestDue.greaterThan(second!.interestDue)).toBe(true);
    });

    it("costs the borrower less than interest-only over the same term", () => {
      const interestOnly = RepaymentEngine.generateSchedule({
        principal: Money.fromMajorUnits(50000),
        ratePercent: 2.5,
        termCount: 3,
        startDate: START,
        repaymentMethod: "INTEREST_ONLY",
      });
      expect(schedule.totalInterest.lessThan(interestOnly.totalInterest)).toBe(true);
    });
  });

  it("BULLET charges the whole term's interest in a single installment", () => {
    const schedule = RepaymentEngine.generateSchedule({
      principal: Money.fromMajorUnits(50000),
      ratePercent: 2.5,
      termCount: 3,
      startDate: START,
      repaymentMethod: "BULLET",
    });
    expect(schedule.installments).toHaveLength(1);
    expect(schedule.totalInterest.toMajorUnitsString()).toBe("3750.00");
    expect(schedule.totalPayable.toMajorUnitsString()).toBe("53750.00");
  });

  it("PRINCIPAL_ONLY charges no interest and still repays every cent", () => {
    const schedule = RepaymentEngine.generateSchedule({
      principal: Money.fromMajorUnits(10000),
      ratePercent: 2.5,
      termCount: 3,
      startDate: START,
      repaymentMethod: "PRINCIPAL_ONLY",
    });
    expect(schedule.totalInterest.isZero()).toBe(true);
    expect(schedule.totalPrincipal.toMajorUnitsString()).toBe("10000.00");
  });

  it("handles principals that do not divide evenly by the term", () => {
    // 10,000 / 3 = 3,333.333...; the remainder must land on the last installment.
    const schedule = RepaymentEngine.generateSchedule({
      principal: Money.fromMajorUnits(10000),
      ratePercent: 1,
      termCount: 3,
      startDate: START,
      repaymentMethod: "PRINCIPAL_ONLY",
    });
    expect(schedule.totalPrincipal.toMajorUnitsString()).toBe("10000.00");
    expect(schedule.installments[2]!.principalDue.toMajorUnitsString()).toBe("3333.34");
  });

  it("rejects a non-positive term", () => {
    expect(() =>
      RepaymentEngine.generateSchedule({
        principal: Money.fromMajorUnits(1000),
        ratePercent: 1,
        termCount: 0,
        startDate: START,
        repaymentMethod: "INTEREST_ONLY",
      })
    ).toThrow(/termCount/);
  });
});
