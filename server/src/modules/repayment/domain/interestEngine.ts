import { Decimal } from "decimal.js";
import { Money } from "../../../shared/money.js";

export type RateUnit = "DAILY" | "MONTHLY" | "ANNUAL";
export type CalculationMethod = "SIMPLE_INTEREST" | "AMORTIZED" | "COMPOUND" | "CUSTOM";

export interface InterestCalculationInput {
  principal: Money;
  /** Rate as a percentage per rateUnit period, e.g. 2.5 means 2.5%. */
  ratePercent: number;
  rateUnit: RateUnit;
  startDate: Date;
  endDate: Date;
  calculationMethod: CalculationMethod;
}

export interface InterestBreakdownEntry {
  periodStart: Date;
  periodEnd: Date;
  days: number;
  interest: Money;
}

export interface InterestCalculationResult {
  interest: Money;
  total: Money;
  days: number;
  months: number;
  breakdown: InterestBreakdownEntry[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_YEAR = 365;

function daysBetween(start: Date, end: Date): number {
  const diff = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
  return Math.max(diff, 0);
}

function monthsBetween(start: Date, end: Date): number {
  const years = end.getFullYear() - start.getFullYear();
  const months = end.getMonth() - start.getMonth();
  let total = years * 12 + months;
  if (end.getDate() < start.getDate()) total -= 1;
  return Math.max(total, 0);
}

const DAYS_PER_MONTH = 30;

/** Date `months` months after `start`, used to find the leftover part-month. */
function addMonths(start: Date, months: number): Date {
  const result = new Date(start.getTime());
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * How many rate periods elapsed between start and end, for the product's
 * rate unit.
 *
 * A MONTHLY product is priced in whole months plus a /30 pro-rata for the
 * part month — NOT by converting the monthly rate to a daily rate. This
 * matters: 2.5%/month for 3 months must be exactly 7.5%, which is what the
 * repayment schedule charges. Pricing the same loan two different ways is a
 * reconciliation bug waiting to happen.
 */
function periodFactor(input: InterestCalculationInput, days: number, months: number): Decimal {
  switch (input.rateUnit) {
    case "DAILY":
      return new Decimal(days);
    case "MONTHLY": {
      const wholeMonthsEnd = addMonths(input.startDate, months);
      const leftoverDays = daysBetween(wholeMonthsEnd, input.endDate);
      return new Decimal(months).plus(new Decimal(leftoverDays).dividedBy(DAYS_PER_MONTH));
    }
    case "ANNUAL":
      return new Decimal(days).dividedBy(DAYS_PER_YEAR);
  }
}

/**
 * InterestEngine — the only place principal * rate * time is computed.
 * v1 supports SIMPLE_INTEREST (interest accrues linearly on the original
 * principal for the elapsed period, no compounding). The interface is
 * shaped so AMORTIZED / COMPOUND / CUSTOM can be added as new branches
 * without changing callers.
 */
export const InterestEngine = {
  calculate(input: InterestCalculationInput): InterestCalculationResult {
    const days = daysBetween(input.startDate, input.endDate);
    const months = monthsBetween(input.startDate, input.endDate);

    switch (input.calculationMethod) {
      case "SIMPLE_INTEREST": {
        const rateFraction = new Decimal(input.ratePercent).dividedBy(100);
        const interest = input.principal.multiply(rateFraction.times(periodFactor(input, days, months)));
        return {
          interest,
          total: input.principal.add(interest),
          days,
          months,
          breakdown: [
            {
              periodStart: input.startDate,
              periodEnd: input.endDate,
              days,
              interest,
            },
          ],
        };
      }
      case "AMORTIZED":
      case "COMPOUND":
      case "CUSTOM":
        throw new Error(`Calculation method ${input.calculationMethod} is not implemented in v1`);
    }
  },

  /** Interest for a single period of a fixed rate per rateUnit, e.g. one monthly installment. */
  calculateForPeriodRate(principal: Money, ratePercent: number): Money {
    return principal.multiply(new Decimal(ratePercent).dividedBy(100));
  },
};
