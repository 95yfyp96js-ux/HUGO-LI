import { describe, expect, it } from "vitest";
import { PricingEngine, type PricingInput } from "../../src/modules/pricing/domain/pricingEngine.js";
import { Money } from "../../src/shared/money.js";

const m = (v: number) => Money.fromMajorUnits(v);

const product: PricingInput["product"] = {
  id: "prod-1",
  ratePercent: 2.5,
  rateUnit: "MONTHLY",
  calculationMethod: "SIMPLE_INTEREST",
  repaymentMethod: "INTEREST_ONLY",
  minAmount: m(10000),
  maxAmount: m(500000),
  minTermMonths: 1,
  maxTermMonths: 24,
  feeRules: [],
};

const base: PricingInput = {
  approvedAmount: m(50000),
  termMonths: 3,
  riskGrade: "A",
  product,
};

describe("PricingEngine", () => {
  it("prices grade A at the product base rate", () => {
    const offer = PricingEngine.priceOffer(base);
    expect(offer.ratePercent).toBe(2.5);
    expect(offer.totalInterest.toMajorUnitsString()).toBe("3750.00");
    expect(offer.totalPayable.toMajorUnitsString()).toBe("53750.00");
    expect(offer.pricingVersion).toBe("pricing-rules-v1");
  });

  it("adds a risk premium for weaker grades", () => {
    const a = PricingEngine.priceOffer(base);
    const c = PricingEngine.priceOffer({ ...base, riskGrade: "C" });
    const e = PricingEngine.priceOffer({ ...base, riskGrade: "E" });
    expect(c.ratePercent).toBeGreaterThan(a.ratePercent);
    expect(e.ratePercent).toBeGreaterThan(c.ratePercent);
    expect(e.totalInterest.greaterThan(a.totalInterest)).toBe(true);
  });

  it("discounts the rate when collateral fully covers the loan", () => {
    const uncovered = PricingEngine.priceOffer({ ...base, riskGrade: "C" });
    const covered = PricingEngine.priceOffer({
      ...base,
      riskGrade: "C",
      collateralValue: m(60000),
    });
    expect(covered.ratePercent).toBeLessThan(uncovered.ratePercent);
    // Never discounts below the product's own base rate.
    expect(covered.ratePercent).toBeGreaterThanOrEqual(product.ratePercent);
  });

  it("prices flat and percentage fees into total payable", () => {
    const offer = PricingEngine.priceOffer({
      ...base,
      product: {
        ...product,
        feeRules: [
          { code: "ORIGINATION", label: "Origination fee", type: "PERCENT_OF_PRINCIPAL", value: 1 },
          { code: "ADMIN", label: "Admin fee", type: "FLAT", value: 300 },
        ],
      },
    });
    expect(offer.totalFees.toMajorUnitsString()).toBe("800.00"); // 500 + 300
    expect(offer.totalPayable.toMajorUnitsString()).toBe("54550.00"); // 50,000 + 3,750 + 800
    expect(offer.fees).toHaveLength(2);
  });

  it("derives interest from the same schedule the borrower will be held to", () => {
    const offer = PricingEngine.priceOffer({
      ...base,
      product: { ...product, repaymentMethod: "PRINCIPAL_AND_INTEREST" },
    });
    // Declining balance costs less than interest-only on the same terms.
    expect(offer.totalInterest.lessThan(m(3750))).toBe(true);
  });

  it("refuses to price outside the product's amount range", () => {
    expect(() => PricingEngine.priceOffer({ ...base, approvedAmount: m(1000) })).toThrow(/minimum/);
    expect(() => PricingEngine.priceOffer({ ...base, approvedAmount: m(900000) })).toThrow(/maximum/);
  });

  it("refuses to price outside the product's term range", () => {
    expect(() => PricingEngine.priceOffer({ ...base, termMonths: 36 })).toThrow(/term range/);
  });

  it("refuses a non-positive amount", () => {
    expect(() => PricingEngine.priceOffer({ ...base, approvedAmount: Money.zero() })).toThrow(/positive/);
  });
});
