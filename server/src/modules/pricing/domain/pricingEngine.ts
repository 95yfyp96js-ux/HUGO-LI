import { Money } from "../../../shared/money.js";
import type { RiskGrade } from "../../risk/domain/riskEngine.js";
import type { CalculationMethod, RateUnit } from "../../repayment/domain/interestEngine.js";
import type { RepaymentMethod } from "../../repayment/domain/repaymentEngine.js";
import { RepaymentEngine } from "../../repayment/domain/repaymentEngine.js";
import { PricingUnavailableError } from "../../../shared/errors.js";
import type { SettlementPolicy } from "../../repayment/domain/settlementPolicy.js";

export const PRICING_VERSION = "pricing-rules-v1";

export interface FeeRule {
  code: string;
  label: string;
  /** Either a flat amount in major units, or a percentage of principal. */
  type: "FLAT" | "PERCENT_OF_PRINCIPAL";
  value: number;
}

export interface PricingInput {
  approvedAmount: Money;
  termMonths: number;
  riskGrade: RiskGrade;
  product: {
    id: string;
    ratePercent: number;
    rateUnit: RateUnit;
    calculationMethod: CalculationMethod;
    repaymentMethod: RepaymentMethod;
    minAmount: Money;
    maxAmount: Money;
    minTermMonths: number;
    maxTermMonths: number;
    feeRules: FeeRule[];
    settlementPolicy: SettlementPolicy;
  };
  /** Optional collateral value; reduces the risk premium when present. */
  collateralValue?: Money | null;
  /**
   * Balance being rolled over from an existing loan on the same product.
   *
   * It was already underwritten and lent under this product, so the product's
   * amount bounds constrain only the NEW money advanced on top. Without this,
   * a rollover whose principal plus accrued interest has grown past the
   * product maximum could never be renewed — which would strand the borrower
   * on a debt they already owe rather than preventing any lending.
   */
  carriedAmount?: Money | null;
}

export interface PricedFee {
  code: string;
  label: string;
  amount: Money;
}

export interface LoanOfferResult {
  approvedAmount: Money;
  ratePercent: number;
  rateUnit: RateUnit;
  calculationMethod: CalculationMethod;
  termMonths: number;
  repaymentMethod: RepaymentMethod;
  settlementPolicy: SettlementPolicy;
  fees: PricedFee[];
  totalFees: Money;
  totalInterest: Money;
  totalPayable: Money;
  pricingVersion: string;
}

/** Risk premium added to the product's base rate, in percentage points per rate unit. */
const RISK_PREMIUM_BY_GRADE: Record<RiskGrade, number> = {
  A: 0,
  B: 0.25,
  C: 0.5,
  D: 1.0,
  E: 2.0,
};

const COLLATERAL_DISCOUNT_PERCENT = 0.25;

/**
 * PricingEngine — turns an approved amount + risk grade + product into a
 * concrete LoanOffer. Rates are never hard-coded in the UI or in services;
 * this is the only place the customer's rate is decided.
 */
export const PricingEngine = {
  priceOffer(input: PricingInput): LoanOfferResult {
    if (!input.approvedAmount.isPositive()) {
      throw new PricingUnavailableError("approved amount must be positive");
    }

    const carried = input.carriedAmount ?? Money.zero();
    if (carried.isNegative()) {
      throw new PricingUnavailableError("carried amount cannot be negative");
    }
    if (carried.greaterThan(input.approvedAmount)) {
      throw new PricingUnavailableError("carried amount exceeds the approved amount");
    }

    if (carried.isZero()) {
      // Ordinary lending: the whole amount must sit inside the product range.
      if (input.approvedAmount.lessThan(input.product.minAmount)) {
        throw new PricingUnavailableError("approved amount is below the product minimum");
      }
      if (input.approvedAmount.greaterThan(input.product.maxAmount)) {
        throw new PricingUnavailableError("approved amount is above the product maximum");
      }
    } else {
      // Rollover: only the new money advanced on top is bound by the product.
      const newMoney = input.approvedAmount.subtract(carried);
      if (newMoney.isPositive() && newMoney.greaterThan(input.product.maxAmount)) {
        throw new PricingUnavailableError("additional advance is above the product maximum");
      }
    }
    if (input.termMonths < input.product.minTermMonths || input.termMonths > input.product.maxTermMonths) {
      throw new PricingUnavailableError("requested term is outside the product term range");
    }

    let ratePercent = input.product.ratePercent + RISK_PREMIUM_BY_GRADE[input.riskGrade];
    if (input.collateralValue && input.collateralValue.greaterThanOrEqual(input.approvedAmount)) {
      ratePercent = Math.max(input.product.ratePercent, ratePercent - COLLATERAL_DISCOUNT_PERCENT);
    }
    ratePercent = Number(ratePercent.toFixed(4));

    const fees = priceFees(input.product.feeRules, input.approvedAmount);
    const totalFees = Money.sum(fees.map((f) => f.amount));

    // Interest is derived from the schedule the customer will actually be
    // held to, so the offer and the schedule can never disagree.
    const schedule = RepaymentEngine.generateSchedule({
      principal: input.approvedAmount,
      ratePercent,
      termMonths: input.termMonths,
      startDate: new Date(0), // dates are irrelevant to the totals; the real schedule is built at loan creation
      repaymentMethod: input.product.repaymentMethod,
    });

    return {
      approvedAmount: input.approvedAmount,
      ratePercent,
      rateUnit: input.product.rateUnit,
      calculationMethod: input.product.calculationMethod,
      termMonths: input.termMonths,
      repaymentMethod: input.product.repaymentMethod,
      settlementPolicy: input.product.settlementPolicy,
      fees,
      totalFees,
      totalInterest: schedule.totalInterest,
      totalPayable: schedule.totalPayable.add(totalFees),
      pricingVersion: PRICING_VERSION,
    };
  },
};

function priceFees(feeRules: FeeRule[], principal: Money): PricedFee[] {
  return feeRules.map((rule) => ({
    code: rule.code,
    label: rule.label,
    amount:
      rule.type === "FLAT"
        ? Money.fromMajorUnits(rule.value)
        : principal.multiply(rule.value / 100),
  }));
}
