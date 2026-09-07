import { Money } from "../../../shared/money.js";
import type { RiskGrade } from "./riskEngine.js";

export const LIMIT_ENGINE_VERSION = "limit-rules-v1";

export type LimitDecision = "LIMIT_AVAILABLE" | "LIMIT_EXCEEDED";

export interface LendingLimitInput {
  monthlyIncome: Money | null;
  riskGrade: RiskGrade;
  currentExposure: Money;
  requestedAmount: Money;
  /** Hard ceiling from the selected product. */
  productMaxAmount: Money;
  productMinAmount: Money;
}

export interface LendingLimitResult {
  maximumLimit: Money;
  currentExposure: Money;
  availableLimit: Money;
  requestedAmount: Money;
  /** What the engine is willing to lend now — never above availableLimit. */
  recommendedAmount: Money;
  decision: LimitDecision;
  reasons: string[];
  engineVersion: string;
}

/** Income multiple allowed per risk grade — the core underwriting lever. */
const INCOME_MULTIPLE_BY_GRADE: Record<RiskGrade, number> = {
  A: 6,
  B: 4,
  C: 3,
  D: 1.5,
  E: 0,
};

/** Fallback ceiling when no verified income exists, per grade (major units). */
const NO_INCOME_CEILING_BY_GRADE: Record<RiskGrade, number> = {
  A: 50000,
  B: 30000,
  C: 20000,
  D: 10000,
  E: 0,
};

/**
 * LendingLimitEngine — decides how much this customer may owe us in total,
 * and therefore how much more we can lend today. The UI never makes this
 * call; it only renders the result.
 */
export const LendingLimitEngine = {
  calculate(input: LendingLimitInput): LendingLimitResult {
    const reasons: string[] = [];

    let maximumLimit: Money;
    if (input.monthlyIncome && input.monthlyIncome.isPositive()) {
      maximumLimit = input.monthlyIncome.multiply(INCOME_MULTIPLE_BY_GRADE[input.riskGrade]);
      reasons.push(
        `Maximum limit set at ${INCOME_MULTIPLE_BY_GRADE[input.riskGrade]}x monthly income for risk grade ${input.riskGrade}`
      );
    } else {
      maximumLimit = Money.fromMajorUnits(NO_INCOME_CEILING_BY_GRADE[input.riskGrade]);
      reasons.push(`No verified income; applying grade ${input.riskGrade} unverified-income ceiling`);
    }

    // The product ceiling is a hard cap on any single exposure.
    if (maximumLimit.greaterThan(input.productMaxAmount)) {
      maximumLimit = input.productMaxAmount;
      reasons.push("Maximum limit capped by product maximum amount");
    }

    const availableLimitRaw = maximumLimit.subtract(input.currentExposure);
    const availableLimit = availableLimitRaw.isNegative() ? Money.zero() : availableLimitRaw;

    if (input.currentExposure.isPositive()) {
      reasons.push(`Current exposure of ${input.currentExposure.toMajorUnitsString()} reduces available limit`);
    }

    const decision: LimitDecision = input.requestedAmount.greaterThan(availableLimit)
      ? "LIMIT_EXCEEDED"
      : "LIMIT_AVAILABLE";

    if (decision === "LIMIT_EXCEEDED") {
      reasons.push(
        `Requested ${input.requestedAmount.toMajorUnitsString()} exceeds available limit ${availableLimit.toMajorUnitsString()}`
      );
    }

    // Recommend the most we can responsibly lend, but never below the
    // product minimum — below that the offer is not viable at all.
    let recommendedAmount = Money.min(input.requestedAmount, availableLimit);
    if (recommendedAmount.lessThan(input.productMinAmount)) {
      recommendedAmount = Money.zero();
      reasons.push("Available limit is below the product minimum amount; no viable offer");
    }

    return {
      maximumLimit,
      currentExposure: input.currentExposure,
      availableLimit,
      requestedAmount: input.requestedAmount,
      recommendedAmount,
      decision,
      reasons,
      engineVersion: LIMIT_ENGINE_VERSION,
    };
  },
};
