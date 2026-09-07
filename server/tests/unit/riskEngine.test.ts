import { describe, expect, it } from "vitest";
import { RiskEngine, type RiskEngineInput } from "../../src/modules/risk/domain/riskEngine.js";
import { Money } from "../../src/shared/money.js";

const cleanCustomer: RiskEngineInput = {
  requestedAmount: Money.fromMajorUnits(50000),
  requestedTermCount: 6,
  monthlyIncome: Money.fromMajorUnits(60000),
  existingDebt: Money.zero(),
  currentExposure: Money.zero(),
  historicalLoanCount: 5,
  paidOffLoanCount: 5,
  latePaymentCount: 0,
  averageDaysLate: 0,
  currentlyOverdueLoanCount: 0,
  customerStatus: "ACTIVE",
};

describe("RiskEngine", () => {
  it("grades a proven repayer with strong income as A / AUTO_APPROVE", () => {
    const result = RiskEngine.assess(cleanCustomer);
    expect(result.grade).toBe("A");
    expect(result.decision).toBe("AUTO_APPROVE");
    expect(result.score).toBeGreaterThanOrEqual(85);
  });

  it("always rejects a blocked customer regardless of other factors", () => {
    const result = RiskEngine.assess({ ...cleanCustomer, customerStatus: "BLOCKED" });
    expect(result.decision).toBe("REJECT");
    expect(result.reasons.join(" ")).toMatch(/blocked/i);
  });

  it("downgrades a customer with loans currently overdue", () => {
    const result = RiskEngine.assess({ ...cleanCustomer, currentlyOverdueLoanCount: 2 });
    expect(result.score).toBeLessThan(RiskEngine.assess(cleanCustomer).score);
    expect(result.reasons.join(" ")).toMatch(/overdue/i);
  });

  it("penalises a high debt-to-income ratio", () => {
    const result = RiskEngine.assess({
      ...cleanCustomer,
      monthlyIncome: Money.fromMajorUnits(20000),
      existingDebt: Money.fromMajorUnits(200000),
      requestedTermCount: 3,
    });
    const dti = result.factors.find((f) => f.code === "DEBT_TO_INCOME");
    expect(dti?.points).toBeGreaterThanOrEqual(30);
    expect(result.reasons.join(" ")).toMatch(/income/i);
    expect(["D", "E"]).toContain(result.grade);
  });

  it("penalises an applicant with no verified income", () => {
    const result = RiskEngine.assess({ ...cleanCustomer, monthlyIncome: null });
    expect(result.reasons.join(" ")).toMatch(/no verified income/i);
    expect(result.score).toBeLessThan(RiskEngine.assess(cleanCustomer).score);
  });

  it("treats a brand new customer as slightly riskier than a proven one", () => {
    const newCustomer = RiskEngine.assess({
      ...cleanCustomer,
      historicalLoanCount: 0,
      paidOffLoanCount: 0,
    });
    expect(newCustomer.score).toBeLessThan(RiskEngine.assess(cleanCustomer).score);
    expect(newCustomer.reasons.join(" ")).toMatch(/no repayment history/i);
  });

  it("routes middling risk to human review rather than auto-approving", () => {
    const result = RiskEngine.assess({
      ...cleanCustomer,
      historicalLoanCount: 4,
      paidOffLoanCount: 1,
      latePaymentCount: 3,
      averageDaysLate: 20,
      monthlyIncome: Money.fromMajorUnits(15000),
    });
    expect(["REVIEW_REQUIRED", "HIGH_RISK", "REJECT"]).toContain(result.decision);
    expect(result.decision).not.toBe("AUTO_APPROVE");
  });

  it("is deterministic and explainable", () => {
    const a = RiskEngine.assess(cleanCustomer);
    const b = RiskEngine.assess(cleanCustomer);
    expect(a.score).toBe(b.score);
    expect(a.factors.length).toBeGreaterThan(0);
    // Every factor must be attributable, so a decline can be explained.
    for (const factor of a.factors) {
      expect(factor.code).toBeTruthy();
      expect(factor.label).toBeTruthy();
    }
    expect(a.modelVersion).toBe("rule-based-v1");
  });

  it("keeps the score inside 0-100", () => {
    const worst = RiskEngine.assess({
      ...cleanCustomer,
      monthlyIncome: null,
      existingDebt: Money.fromMajorUnits(9999999),
      currentExposure: Money.fromMajorUnits(9999999),
      historicalLoanCount: 10,
      paidOffLoanCount: 0,
      latePaymentCount: 50,
      averageDaysLate: 200,
      currentlyOverdueLoanCount: 9,
      customerStatus: "INACTIVE",
    });
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThanOrEqual(100);
    expect(worst.grade).toBe("E");
  });
});
