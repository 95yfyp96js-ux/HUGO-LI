import { Money } from "../../../shared/money.js";

export type RiskGrade = "A" | "B" | "C" | "D" | "E";
export type RiskDecision = "AUTO_APPROVE" | "REVIEW_REQUIRED" | "HIGH_RISK" | "REJECT";

export const RISK_MODEL_VERSION = "rule-based-v1";

export interface RiskEngineInput {
  requestedAmount: Money;
  requestedTermCount: number;
  monthlyIncome: Money | null;
  existingDebt: Money;
  currentExposure: Money;
  historicalLoanCount: number;
  paidOffLoanCount: number;
  latePaymentCount: number;
  averageDaysLate: number;
  currentlyOverdueLoanCount: number;
  customerStatus: string;
}

export interface RiskFactorResult {
  code: string;
  label: string;
  value: string;
  /** Positive points increase risk. */
  points: number;
}

export interface RiskAssessmentResult {
  score: number; // 0-100, higher is safer
  grade: RiskGrade;
  decision: RiskDecision;
  reasons: string[];
  factors: RiskFactorResult[];
  modelVersion: string;
}

/**
 * A single risk rule. Rules are pure functions of the input so the engine is
 * deterministic and unit-testable; adding a rule never requires touching
 * scoring/grading logic.
 */
interface RiskRule {
  code: string;
  label: string;
  evaluate(input: RiskEngineInput): { value: string; points: number; reason?: string };
}

const BASE_SCORE = 100;

const rules: RiskRule[] = [
  {
    code: "CUSTOMER_STATUS",
    label: "Customer status",
    evaluate: (i) => {
      if (i.customerStatus === "BLOCKED") {
        return { value: i.customerStatus, points: 100, reason: "Customer is blocked" };
      }
      if (i.customerStatus === "INACTIVE" || i.customerStatus === "ARCHIVED") {
        return { value: i.customerStatus, points: 10, reason: "Customer is not active" };
      }
      return { value: i.customerStatus, points: 0 };
    },
  },
  {
    code: "CURRENTLY_OVERDUE",
    label: "Currently overdue loans",
    evaluate: (i) => {
      if (i.currentlyOverdueLoanCount <= 0) return { value: "0", points: 0 };
      const points = Math.min(40, 20 * i.currentlyOverdueLoanCount);
      return {
        value: String(i.currentlyOverdueLoanCount),
        points,
        reason: `Customer has ${i.currentlyOverdueLoanCount} loan(s) currently overdue`,
      };
    },
  },
  {
    code: "LATE_PAYMENT_HISTORY",
    label: "Previous late payments",
    evaluate: (i) => {
      if (i.latePaymentCount <= 0) return { value: "0", points: 0 };
      const points = Math.min(25, 5 * i.latePaymentCount);
      return {
        value: String(i.latePaymentCount),
        points,
        reason: `${i.latePaymentCount} late payment(s) in history`,
      };
    },
  },
  {
    code: "AVERAGE_DAYS_LATE",
    label: "Average days late",
    evaluate: (i) => {
      if (i.averageDaysLate <= 0) return { value: "0", points: 0 };
      if (i.averageDaysLate <= 7) return { value: String(i.averageDaysLate), points: 5 };
      if (i.averageDaysLate <= 30) {
        return { value: String(i.averageDaysLate), points: 12, reason: "Average delinquency over one week" };
      }
      return { value: String(i.averageDaysLate), points: 20, reason: "Average delinquency over one month" };
    },
  },
  {
    code: "DEBT_TO_INCOME",
    label: "Debt-to-income ratio",
    evaluate: (i) => {
      if (!i.monthlyIncome || i.monthlyIncome.isZero()) {
        return { value: "unknown", points: 15, reason: "No verified income on file" };
      }
      // Monthly obligation proxy: (existing debt + requested amount) spread over the term.
      const totalObligation = i.existingDebt.add(i.requestedAmount);
      const monthlyObligation = totalObligation.toMajorUnitsNumber() / Math.max(i.requestedTermCount, 1);
      const ratio = monthlyObligation / i.monthlyIncome.toMajorUnitsNumber();
      const value = ratio.toFixed(2);
      if (ratio <= 0.3) return { value, points: 0 };
      if (ratio <= 0.5) return { value, points: 8 };
      if (ratio <= 0.8) return { value, points: 18, reason: "Debt-to-income ratio above 50%" };
      if (ratio <= 1.5) return { value, points: 30, reason: "Debt-to-income ratio above 80%" };
      // Obligations exceed 150% of income: affordability failure that a good
      // repayment record must not be able to offset.
      return { value, points: 60, reason: "Monthly obligations exceed 150% of monthly income" };
    },
  },
  {
    code: "CURRENT_EXPOSURE",
    label: "Current exposure vs requested",
    evaluate: (i) => {
      if (i.currentExposure.isZero()) return { value: "0", points: 0 };
      const ratio = i.currentExposure.toMajorUnitsNumber() / Math.max(i.requestedAmount.toMajorUnitsNumber(), 1);
      const value = ratio.toFixed(2);
      if (ratio <= 1) return { value, points: 5 };
      if (ratio <= 2) return { value, points: 12, reason: "Existing exposure exceeds requested amount" };
      return { value, points: 20, reason: "Existing exposure far exceeds requested amount" };
    },
  },
  {
    code: "REPAYMENT_TRACK_RECORD",
    label: "Repayment track record",
    evaluate: (i) => {
      if (i.historicalLoanCount === 0) {
        return { value: "new customer", points: 10, reason: "No repayment history with us" };
      }
      const paidRatio = i.paidOffLoanCount / i.historicalLoanCount;
      const value = `${i.paidOffLoanCount}/${i.historicalLoanCount}`;
      if (paidRatio >= 0.8) return { value, points: -10 }; // rewards proven repayers
      if (paidRatio >= 0.5) return { value, points: 0 };
      return { value, points: 8, reason: "Majority of historical loans not yet paid off" };
    },
  },
];

function gradeFor(score: number): RiskGrade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "E";
}

function decisionFor(grade: RiskGrade, input: RiskEngineInput): RiskDecision {
  if (input.customerStatus === "BLOCKED") return "REJECT";
  switch (grade) {
    case "A":
    case "B":
      return "AUTO_APPROVE";
    case "C":
      return "REVIEW_REQUIRED";
    case "D":
      return "HIGH_RISK";
    case "E":
      return "REJECT";
  }
}

/**
 * RiskEngine — rule-based, deterministic, versioned. Deliberately NOT an ML
 * model in v1: every decline must be explainable to a human reviewer. The
 * RiskModel interface below is the seam where a future ML/bureau model can be
 * plugged in; note that no model may mutate a Loan directly — it only
 * produces an assessment that a human/approval flow acts on.
 */
export interface RiskModel {
  assess(input: RiskEngineInput): RiskAssessmentResult;
}

export const RiskEngine: RiskModel = {
  assess(input: RiskEngineInput): RiskAssessmentResult {
    const factors: RiskFactorResult[] = [];
    const reasons: string[] = [];
    let penalty = 0;

    for (const rule of rules) {
      const outcome = rule.evaluate(input);
      factors.push({
        code: rule.code,
        label: rule.label,
        value: outcome.value,
        points: outcome.points,
      });
      penalty += outcome.points;
      if (outcome.reason) reasons.push(outcome.reason);
    }

    const score = Math.max(0, Math.min(100, BASE_SCORE - penalty));
    const grade = gradeFor(score);
    const decision = decisionFor(grade, input);

    if (reasons.length === 0) reasons.push("No adverse risk factors identified");

    return { score, grade, decision, reasons, factors, modelVersion: RISK_MODEL_VERSION };
  },
};
