import { describe, expect, it } from "vitest";
import { InterestEngine } from "../../src/modules/repayment/domain/interestEngine.js";
import { Money } from "../../src/shared/money.js";

describe("InterestEngine", () => {
  // Spec §57 financial test case.
  describe("Principal 50,000 @ 2.5%/month for 3 months", () => {
    const input = {
      principal: Money.fromMajorUnits(50000),
      ratePercent: 2.5,
      rateUnit: "MONTHLY" as const,
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-04-01T00:00:00Z"),
      calculationMethod: "SIMPLE_INTEREST" as const,
    };

    it("charges exactly 7.5% of principal", () => {
      const result = InterestEngine.calculate(input);
      expect(result.interest.toMajorUnitsString()).toBe("3750.00");
    });

    it("returns total payable of principal plus interest", () => {
      const result = InterestEngine.calculate(input);
      expect(result.total.toMajorUnitsString()).toBe("53750.00");
    });

    it("reports the elapsed days and months it priced", () => {
      const result = InterestEngine.calculate(input);
      expect(result.months).toBe(3);
      expect(result.days).toBe(90);
      expect(result.breakdown).toHaveLength(1);
    });
  });

  it("pro-rates a part month on a monthly product", () => {
    // 1 whole month + 15 days => 1.5 monthly periods => 3.75% of 10,000
    const result = InterestEngine.calculate({
      principal: Money.fromMajorUnits(10000),
      ratePercent: 2.5,
      rateUnit: "MONTHLY",
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-02-16T00:00:00Z"),
      calculationMethod: "SIMPLE_INTEREST",
    });
    expect(result.interest.toMajorUnitsString()).toBe("375.00");
  });

  it("prices a daily rate per elapsed day", () => {
    const result = InterestEngine.calculate({
      principal: Money.fromMajorUnits(100000),
      ratePercent: 0.05,
      rateUnit: "DAILY",
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-01-31T00:00:00Z"),
      calculationMethod: "SIMPLE_INTEREST",
    });
    // 100,000 * 0.05% * 30 days = 1,500
    expect(result.interest.toMajorUnitsString()).toBe("1500.00");
  });

  it("prices an annual rate on an actual/365 basis", () => {
    const result = InterestEngine.calculate({
      principal: Money.fromMajorUnits(365000),
      ratePercent: 10,
      rateUnit: "ANNUAL",
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-01-11T00:00:00Z"),
      calculationMethod: "SIMPLE_INTEREST",
    });
    // 365,000 * 10% * 10/365 = 1,000
    expect(result.interest.toMajorUnitsString()).toBe("1000.00");
  });

  it("charges nothing for a zero-length period", () => {
    const result = InterestEngine.calculate({
      principal: Money.fromMajorUnits(50000),
      ratePercent: 2.5,
      rateUnit: "MONTHLY",
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-01-01T00:00:00Z"),
      calculationMethod: "SIMPLE_INTEREST",
    });
    expect(result.interest.isZero()).toBe(true);
  });

  it("refuses calculation methods that are not implemented in v1", () => {
    expect(() =>
      InterestEngine.calculate({
        principal: Money.fromMajorUnits(1000),
        ratePercent: 1,
        rateUnit: "MONTHLY",
        startDate: new Date("2026-01-01T00:00:00Z"),
        endDate: new Date("2026-02-01T00:00:00Z"),
        calculationMethod: "COMPOUND",
      })
    ).toThrow(/not implemented/i);
  });
});
