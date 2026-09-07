import { Money } from "../../../shared/money.js";
import { InterestEngine } from "./interestEngine.js";
import { ScheduleCalculationFailedError } from "../../../shared/errors.js";

export type RepaymentMethod = "INTEREST_ONLY" | "PRINCIPAL_AND_INTEREST" | "PRINCIPAL_ONLY" | "BULLET" | "CUSTOM";

export interface RepaymentScheduleInput {
  principal: Money;
  ratePercent: number; // percent per month, matching product rateUnit=MONTHLY assumption for v1 schedules
  termMonths: number;
  startDate: Date;
  repaymentMethod: RepaymentMethod;
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

function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * RepaymentEngine — the only place a LoanSchedule is generated. v1 assumes a
 * monthly rate and monthly frequency; per-installment interest is priced via
 * InterestEngine.calculateForPeriodRate so rounding rules stay in one place.
 */
export const RepaymentEngine = {
  generateSchedule(input: RepaymentScheduleInput): LoanSchedule {
    if (input.termMonths <= 0) {
      throw new ScheduleCalculationFailedError("termMonths must be positive");
    }

    switch (input.repaymentMethod) {
      case "INTEREST_ONLY":
        return interestOnlySchedule(input);
      case "PRINCIPAL_AND_INTEREST":
        return principalAndInterestSchedule(input);
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
  const monthlyInterest = InterestEngine.calculateForPeriodRate(input.principal, input.ratePercent);
  const installments: ScheduleInstallment[] = [];
  for (let n = 1; n <= input.termMonths; n++) {
    const isLast = n === input.termMonths;
    installments.push({
      installmentNumber: n,
      dueDate: addMonths(input.startDate, n),
      principalDue: isLast ? input.principal : Money.zero(),
      interestDue: monthlyInterest,
      feeDue: Money.zero(),
    });
  }
  return summarize(installments);
}

/** Equal principal per installment; interest computed on the declining outstanding balance. */
function principalAndInterestSchedule(input: RepaymentScheduleInput): LoanSchedule {
  const installments: ScheduleInstallment[] = [];
  let allocatedPrincipal = Money.zero();
  let remainingBalance = input.principal;

  for (let n = 1; n <= input.termMonths; n++) {
    const isLast = n === input.termMonths;
    const interestDue = InterestEngine.calculateForPeriodRate(remainingBalance, input.ratePercent);
    const principalDue = isLast ? input.principal.subtract(allocatedPrincipal) : roundPrincipalShare(input.principal, input.termMonths);
    allocatedPrincipal = allocatedPrincipal.add(principalDue);
    remainingBalance = remainingBalance.subtract(principalDue);

    installments.push({
      installmentNumber: n,
      dueDate: addMonths(input.startDate, n),
      principalDue,
      interestDue,
      feeDue: Money.zero(),
    });
  }
  return summarize(installments);
}

function roundPrincipalShare(principal: Money, termMonths: number): Money {
  return Money.fromMinorUnits(Math.floor(principal.toMinorUnits() / termMonths));
}

/** No interest component; used for principal-only side arrangements. */
function principalOnlySchedule(input: RepaymentScheduleInput): LoanSchedule {
  const installments: ScheduleInstallment[] = [];
  let allocatedPrincipal = Money.zero();
  for (let n = 1; n <= input.termMonths; n++) {
    const isLast = n === input.termMonths;
    const principalDue = isLast ? input.principal.subtract(allocatedPrincipal) : roundPrincipalShare(input.principal, input.termMonths);
    allocatedPrincipal = allocatedPrincipal.add(principalDue);
    installments.push({
      installmentNumber: n,
      dueDate: addMonths(input.startDate, n),
      principalDue,
      interestDue: Money.zero(),
      feeDue: Money.zero(),
    });
  }
  return summarize(installments);
}

/** Single installment at maturity covering principal plus interest for the whole term. */
function bulletSchedule(input: RepaymentScheduleInput): LoanSchedule {
  const totalInterest = InterestEngine.calculateForPeriodRate(input.principal, input.ratePercent * input.termMonths);
  return summarize(
    [
      {
        installmentNumber: 1,
        dueDate: addMonths(input.startDate, input.termMonths),
        principalDue: input.principal,
        interestDue: totalInterest,
        feeDue: Money.zero(),
      },
    ]
  );
}
