import { Decimal } from "decimal.js";
import { Money } from "../../../shared/money.js";
import { InterestEngine, type RateUnit } from "./interestEngine.js";
import { ScheduleCalculationFailedError } from "../../../shared/errors.js";

export type RepaymentMethod =
  | "INTEREST_ONLY"
  | "PRINCIPAL_AND_INTEREST"
  | "EQUAL_INSTALLMENT"
  | "PRINCIPAL_ONLY"
  | "BULLET"
  | "CUSTOM";

/** What a term is counted in. One installment covers exactly one of these. */
export type TermUnit = "DAY" | "MONTH";

/**
 * Days per month used to convert between a daily and a monthly rate. The same
 * 30-day convention the pro-rata interest calculation uses, kept here so the
 * two cannot drift apart.
 */
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;
const MONTHS_PER_YEAR = 12;

export interface RepaymentScheduleInput {
  principal: Money;
  /** Percent per `rateUnit` period, e.g. 2.5 with MONTHLY means 2.5% a month. */
  ratePercent: number;
  termCount: number;
  startDate: Date;
  repaymentMethod: RepaymentMethod;
  /** Defaults to MONTH, which is what every product did before day terms existed. */
  termUnit?: TermUnit;
  /** Defaults to MONTHLY, matching the historical assumption. */
  rateUnit?: RateUnit;
}

/**
 * Converts a rate quoted per `rateUnit` into the rate for one installment
 * period.
 *
 * Without this a product quoted at an annual rate charged that whole rate on
 * every monthly installment — twelve times the agreed price. The schedule
 * period and the rate period are independent choices, so the conversion has
 * to be explicit.
 */
export function periodRate(ratePercent: number, rateUnit: RateUnit, termUnit: TermUnit): number {
  const perDay =
    rateUnit === "DAILY"
      ? ratePercent
      : rateUnit === "MONTHLY"
        ? ratePercent / DAYS_PER_MONTH
        : ratePercent / DAYS_PER_YEAR;

  if (termUnit === "DAY") return perDay;
  return rateUnit === "MONTHLY"
    ? ratePercent // exact, rather than round-tripping through days
    : rateUnit === "ANNUAL"
      ? ratePercent / MONTHS_PER_YEAR
      : perDay * DAYS_PER_MONTH;
}

export interface ScheduleInstallment {
  installmentNumber: number;
  dueDate: Date;
  principalDue: Money;
  interestDue: Money;
  feeDue: Money;
}

export interface LoanSchedule {
  installments: ScheduleInstallment[];
  totalPrincipal: Money;
  totalInterest: Money;
  totalPayable: Money;
}

function addPeriods(date: Date, periods: number, unit: TermUnit): Date {
  const result = new Date(date.getTime());
  if (unit === "DAY") {
    result.setDate(result.getDate() + periods);
  } else {
    result.setMonth(result.getMonth() + periods);
  }
  return result;
}

/** The rate for one installment, and the unit its due dates advance by. */
function periodTerms(input: RepaymentScheduleInput): { rate: number; unit: TermUnit } {
  const unit = input.termUnit ?? "MONTH";
  return { rate: periodRate(input.ratePercent, input.rateUnit ?? "MONTHLY", unit), unit };
}

/**
 * RepaymentEngine — the only place a LoanSchedule is generated.
 *
 * A term is a count of periods and a period is a day or a month; the rate is
 * converted to that period once, up front. A 7-day loan at 0.1% a day and a
 * 3-month loan at 2.5% a month are therefore the same arithmetic, and
 * per-installment interest still goes through
 * InterestEngine.calculateForPeriodRate so rounding lives in one place.
 */
export const RepaymentEngine = {
  generateSchedule(input: RepaymentScheduleInput): LoanSchedule {
    if (input.termCount <= 0) {
      throw new ScheduleCalculationFailedError("termCount must be positive");
    }

    switch (input.repaymentMethod) {
      case "INTEREST_ONLY":
        return interestOnlySchedule(input);
      case "PRINCIPAL_AND_INTEREST":
        return principalAndInterestSchedule(input);
      case "EQUAL_INSTALLMENT":
        return equalInstallmentSchedule(input);
      case "PRINCIPAL_ONLY":
        return principalOnlySchedule(input);
      case "BULLET":
        return bulletSchedule(input);
      case "CUSTOM":
        throw new ScheduleCalculationFailedError("CUSTOM repayment method is not implemented in v1");
    }
  },
};

function summarize(installments: ScheduleInstallment[]): LoanSchedule {
  const totalInterest = Money.sum(installments.map((i) => i.interestDue));
  const totalPrincipal = Money.sum(installments.map((i) => i.principalDue));
  const totalFees = Money.sum(installments.map((i) => i.feeDue));
  return {
    installments,
    totalPrincipal,
    totalInterest,
    totalPayable: totalPrincipal.add(totalInterest).add(totalFees),
  };
}

/** Interest charged on the full principal every month; principal repaid entirely in the final installment. */
function interestOnlySchedule(input: RepaymentScheduleInput): LoanSchedule {
  const { rate, unit } = periodTerms(input);
  const periodInterest = InterestEngine.calculateForPeriodRate(input.principal, rate);
  const installments: ScheduleInstallment[] = [];
  for (let n = 1; n <= input.termCount; n++) {
    const isLast = n === input.termCount;
    installments.push({
      installmentNumber: n,
      dueDate: addPeriods(input.startDate, n, unit),
      principalDue: isLast ? input.principal : Money.zero(),
      interestDue: periodInterest,
      feeDue: Money.zero(),
    });
  }
  return summarize(installments);
}

/** Equal principal per installment; interest computed on the declining outstanding balance. */
function principalAndInterestSchedule(input: RepaymentScheduleInput): LoanSchedule {
  const { rate, unit } = periodTerms(input);
  const installments: ScheduleInstallment[] = [];
  let allocatedPrincipal = Money.zero();
  let remainingBalance = input.principal;

  for (let n = 1; n <= input.termCount; n++) {
    const isLast = n === input.termCount;
    const interestDue = InterestEngine.calculateForPeriodRate(remainingBalance, rate);
    const principalDue = isLast ? input.principal.subtract(allocatedPrincipal) : roundPrincipalShare(input.principal, input.termCount);
    allocatedPrincipal = allocatedPrincipal.add(principalDue);
    remainingBalance = remainingBalance.subtract(principalDue);

    installments.push({
      installmentNumber: n,
      dueDate: addPeriods(input.startDate, n, unit),
      principalDue,
      interestDue,
      feeDue: Money.zero(),
    });
  }
  return summarize(installments);
}

function roundPrincipalShare(principal: Money, termCount: number): Money {
  return Money.fromMinorUnits(Math.floor(principal.toMinorUnits() / termCount));
}

/**
 * Equal total payment per installment (等額本息 / French amortization):
 * principal + interest is level across periods, interest computed on the
 * declining balance via the same InterestEngine.calculateForPeriodRate every
 * other method uses, so only the payment split is new here — not the
 * interest math itself.
 *
 * payment = principal * r / (1 - (1+r)^-n), or principal / n when r is 0.
 * The last installment absorbs whatever the cent has left over, the same
 * convention principalAndInterestSchedule uses, so the balance always
 * reaches exactly zero.
 */
function equalInstallmentSchedule(input: RepaymentScheduleInput): LoanSchedule {
  const { rate, unit } = periodTerms(input);
  const r = new Decimal(rate).dividedBy(100);
  const n = input.termCount;

  const payment: Money = r.isZero()
    ? Money.fromMinorUnits(Math.floor(input.principal.toMinorUnits() / n))
    : input.principal.multiply(r.dividedBy(new Decimal(1).minus(new Decimal(1).plus(r).pow(-n))));

  const installments: ScheduleInstallment[] = [];
  let allocatedPrincipal = Money.zero();
  let remainingBalance = input.principal;

  for (let k = 1; k <= n; k++) {
    const isLast = k === n;
    const interestDue = InterestEngine.calculateForPeriodRate(remainingBalance, rate);

    let principalDue: Money;
    if (isLast) {
      principalDue = input.principal.subtract(allocatedPrincipal);
    } else {
      principalDue = payment.subtract(interestDue);
      if (principalDue.isNegative()) principalDue = Money.zero();
      if (principalDue.greaterThan(remainingBalance)) principalDue = remainingBalance;
    }

    allocatedPrincipal = allocatedPrincipal.add(principalDue);
    remainingBalance = remainingBalance.subtract(principalDue);

    installments.push({
      installmentNumber: k,
      dueDate: addPeriods(input.startDate, k, unit),
      principalDue,
      interestDue,
      feeDue: Money.zero(),
    });
  }
  return summarize(installments);
}

/** No interest component; used for principal-only side arrangements. */
function principalOnlySchedule(input: RepaymentScheduleInput): LoanSchedule {
  const { unit } = periodTerms(input);
  const installments: ScheduleInstallment[] = [];
  let allocatedPrincipal = Money.zero();
  for (let n = 1; n <= input.termCount; n++) {
    const isLast = n === input.termCount;
    const principalDue = isLast ? input.principal.subtract(allocatedPrincipal) : roundPrincipalShare(input.principal, input.termCount);
    allocatedPrincipal = allocatedPrincipal.add(principalDue);
    installments.push({
      installmentNumber: n,
      dueDate: addPeriods(input.startDate, n, unit),
      principalDue,
      interestDue: Money.zero(),
      feeDue: Money.zero(),
    });
  }
  return summarize(installments);
}

/** Single installment at maturity covering principal plus interest for the whole term. */
function bulletSchedule(input: RepaymentScheduleInput): LoanSchedule {
  const { rate, unit } = periodTerms(input);
  const totalInterest = InterestEngine.calculateForPeriodRate(input.principal, rate * input.termCount);
  return summarize(
    [
      {
        installmentNumber: 1,
        dueDate: addPeriods(input.startDate, input.termCount, unit),
        principalDue: input.principal,
        interestDue: totalInterest,
        feeDue: Money.zero(),
      },
    ]
  );
}
