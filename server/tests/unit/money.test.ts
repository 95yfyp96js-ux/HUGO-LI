import { describe, expect, it } from "vitest";
import { Money } from "../../src/shared/money.js";

describe("Money", () => {
  it("parses major units without floating point drift", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE754; Money must not have this problem.
    const total = Money.fromMajorUnits("0.10").add(Money.fromMajorUnits("0.20"));
    expect(total.toMajorUnitsString()).toBe("0.30");
  });

  it("keeps cent precision on large principals", () => {
    const m = Money.fromMajorUnits(50000);
    expect(m.toMinorUnits()).toBe(5_000_000);
    expect(m.toMajorUnitsString()).toBe("50000.00");
  });

  it("rounds half up when multiplying by a rate", () => {
    // 1000.005 -> 1000.01
    const result = Money.fromMajorUnits("100000.50").multiply(0.01);
    expect(result.toMajorUnitsString()).toBe("1000.01");
  });

  it("supports comparison and sum helpers", () => {
    const a = Money.fromMajorUnits(100);
    const b = Money.fromMajorUnits(250);
    expect(Money.min(a, b).equals(a)).toBe(true);
    expect(Money.max(a, b).equals(b)).toBe(true);
    expect(Money.sum([a, b]).toMajorUnitsString()).toBe("350.00");
    expect(a.subtract(b).isNegative()).toBe(true);
  });
});
