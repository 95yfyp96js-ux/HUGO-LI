import { describe, expect, it } from "vitest";
import { LendingLimitEngine } from "../../src/modules/risk/domain/lendingLimitEngine.js";
import { Money } from "../../src/shared/money.js";

const m = (v: number) => Money.fromMajorUnits(v);

const base = {
  monthlyIncome: m(50000),
  riskGrade: "A" as const,
  currentExposure: Money.zero(),
  requestedAmount: m(100000),
  productMaxAmount: m(500000),
  productMinAmount: m(10000),
};

describe("LendingLimitEngine", () => {
  it("sets the maximum limit from an income multiple for the risk grade", () => {
    const result = LendingLimitEngine.calculate(base);
    // Grade A = 6x monthly income
    expect(result.maximumLimit.toMajorUnitsString()).toBe("300000.00");
    expect(result.decision).toBe("LIMIT_AVAILABLE");
  });

  // Spec §10 worked example.
  it("reduces the available limit by current exposure", () => {
    const result = LendingLimitEngine.calculate({
      ...base,
      monthlyIncome: m(50000),
      currentExposure: m(100000),
      requestedAmount: m(250000),
    });
    expect(result.maximumLimit.toMajorUnitsString()).toBe("300000.00");
    expect(result.currentExposure.toMajorUnitsString()).toBe("100000.00");
    expect(result.availableLimit.toMajorUnitsString()).toBe("200000.00");
    expect(result.decision).toBe("LIMIT_EXCEEDED");
    // It still tells the officer what it WOULD lend.
    expect(result.recommendedAmount.toMajorUnitsString()).toBe("200000.00");
  });

  it("lends less to a weaker risk grade on the same income", () => {
    const gradeA = LendingLimitEngine.calculate(base);
    const gradeD = LendingLimitEngine.calculate({ ...base, riskGrade: "D" });
    expect(gradeD.maximumLimit.lessThan(gradeA.maximumLimit)).toBe(true);
  });

  it("lends nothing to grade E", () => {
    const result = LendingLimitEngine.calculate({ ...base, riskGrade: "E" });
    expect(result.maximumLimit.isZero()).toBe(true);
    expect(result.availableLimit.isZero()).toBe(true);
    expect(result.recommendedAmount.isZero()).toBe(true);
    expect(result.decision).toBe("LIMIT_EXCEEDED");
  });

  it("caps the limit at the product maximum", () => {
    const result = LendingLimitEngine.calculate({
      ...base,
      monthlyIncome: m(500000),
      productMaxAmount: m(200000),
    });
    expect(result.maximumLimit.toMajorUnitsString()).toBe("200000.00");
    expect(result.reasons.join(" ")).toMatch(/product maximum/i);
  });

  it("falls back to an unverified-income ceiling when income is unknown", () => {
    const result = LendingLimitEngine.calculate({ ...base, monthlyIncome: null, requestedAmount: m(20000) });
    expect(result.maximumLimit.toMajorUnitsString()).toBe("50000.00");
    expect(result.reasons.join(" ")).toMatch(/unverified-income/i);
    expect(result.decision).toBe("LIMIT_AVAILABLE");
  });

  it("never lets available limit go negative when over-exposed", () => {
    const result = LendingLimitEngine.calculate({ ...base, currentExposure: m(999999) });
    expect(result.availableLimit.isZero()).toBe(true);
    expect(result.availableLimit.isNegative()).toBe(false);
  });

  it("recommends nothing when the room left is below the product minimum", () => {
    const result = LendingLimitEngine.calculate({
      ...base,
      currentExposure: m(295000), // only 5,000 of room, product min is 10,000
      requestedAmount: m(50000),
    });
    expect(result.recommendedAmount.isZero()).toBe(true);
    expect(result.reasons.join(" ")).toMatch(/below the product minimum/i);
  });

  it("recommends the requested amount when it fits", () => {
    const result = LendingLimitEngine.calculate({ ...base, requestedAmount: m(80000) });
    expect(result.recommendedAmount.toMajorUnitsString()).toBe("80000.00");
    expect(result.decision).toBe("LIMIT_AVAILABLE");
  });
});
