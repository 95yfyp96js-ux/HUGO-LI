import { describe, expect, it } from "vitest";
import { AllocationEngine } from "../../src/modules/payment/domain/allocationEngine.js";
import { Money } from "../../src/shared/money.js";

const outstanding = {
  interest: Money.fromMajorUnits(4500),
  fees: Money.fromMajorUnits(300),
  principal: Money.fromMajorUnits(80000),
};

describe("AllocationEngine", () => {
  // Spec §39 worked example: 20,000 against 4,500 interest / 300 fees / 80,000 principal.
  it("allocates interest, then fees, then principal", () => {
    const result = AllocationEngine.allocate(Money.fromMajorUnits(20000), outstanding);
    expect(result.interestAmount.toMajorUnitsString()).toBe("4500.00");
    expect(result.feeAmount.toMajorUnitsString()).toBe("300.00");
    expect(result.principalAmount.toMajorUnitsString()).toBe("15200.00");
    expect(result.unallocated.isZero()).toBe(true);
  });

  // Spec §58 partial payment case.
  it("puts a small payment entirely against interest first", () => {
    const result = AllocationEngine.allocate(Money.fromMajorUnits(1000), outstanding);
    expect(result.interestAmount.toMajorUnitsString()).toBe("1000.00");
    expect(result.feeAmount.isZero()).toBe(true);
    expect(result.principalAmount.isZero()).toBe(true);
  });

  it("never allocates more than is owed in any bucket", () => {
    const result = AllocationEngine.allocate(Money.fromMajorUnits(200000), outstanding);
    expect(result.interestAmount.toMajorUnitsString()).toBe("4500.00");
    expect(result.feeAmount.toMajorUnitsString()).toBe("300.00");
    expect(result.principalAmount.toMajorUnitsString()).toBe("80000.00");
    // Overpayment surfaces rather than silently vanishing into principal.
    expect(result.unallocated.toMajorUnitsString()).toBe("115200.00");
  });

  it("always reconciles allocation back to the payment amount", () => {
    for (const amount of [1, 4500, 4800, 20000, 84800, 90000]) {
      const result = AllocationEngine.allocate(Money.fromMajorUnits(amount), outstanding);
      const total = result.interestAmount
        .add(result.feeAmount)
        .add(result.principalAmount)
        .add(result.unallocated);
      expect(total.toMajorUnitsString()).toBe(Money.fromMajorUnits(amount).toMajorUnitsString());
    }
  });

  it("rejects a zero or negative payment", () => {
    expect(() => AllocationEngine.allocate(Money.zero(), outstanding)).toThrow(/must be positive/);
    expect(() => AllocationEngine.allocate(Money.fromMajorUnits(-5), outstanding)).toThrow(/must be positive/);
  });
});
