import { Money } from "../../../shared/money.js";
import type { LoanStatus } from "./loanStateMachine.js";

export type DelinquencyStatus = "CURRENT" | "DUE_SOON" | "DUE" | "OVERDUE";

export interface OverdueScheduleLine {
  installmentNumber: number;
  dueDate: Date;
  totalDue: Money;
  totalPaid: Money;
}

export interface OverdueInput {
  scheduleLines: OverdueScheduleLine[];
  currentDate: Date;
  /** Days before a due date at which we start warning. */
  dueSoonWindowDays?: number;
}

export interface OverdueResult {
  status: DelinquencyStatus;
  daysOverdue: number;
  overdueAmount: Money;
  overdueInstallments: number[];
  nextDueDate: Date | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_DUE_SOON_WINDOW_DAYS = 7;

function startOfDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((startOfDay(to) - startOfDay(from)) / MS_PER_DAY);
}

/**
 * OverdueEngine — pure function of (schedule, currentDate). It takes the date
 * as an argument rather than calling `new Date()`, which is what makes the
 * MockClock-driven delinquency tests possible.
 */
export const OverdueEngine = {
  evaluate(input: OverdueInput): OverdueResult {
    const dueSoonWindow = input.dueSoonWindowDays ?? DEFAULT_DUE_SOON_WINDOW_DAYS;
    const unpaid = input.scheduleLines.filter((line) => line.totalPaid.lessThan(line.totalDue));

    const overdueLines = unpaid.filter((line) => wholeDaysBetween(line.dueDate, input.currentDate) > 0);
    const overdueAmount = Money.sum(overdueLines.map((l) => l.totalDue.subtract(l.totalPaid)));
    const overdueInstallments = overdueLines.map((l) => l.installmentNumber).sort((a, b) => a - b);

    // Delinquency age is measured from the OLDEST unpaid installment.
    const daysOverdue = overdueLines.reduce((max, line) => {
      const days = wholeDaysBetween(line.dueDate, input.currentDate);
      return days > max ? days : max;
    }, 0);

    const upcoming = unpaid
      .filter((line) => wholeDaysBetween(line.dueDate, input.currentDate) <= 0)
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    const nextDueDate = upcoming[0]?.dueDate ?? null;

    let status: DelinquencyStatus;
    if (overdueLines.length > 0) {
      status = "OVERDUE";
    } else if (nextDueDate && wholeDaysBetween(input.currentDate, nextDueDate) === 0) {
      status = "DUE";
    } else if (nextDueDate && wholeDaysBetween(input.currentDate, nextDueDate) <= dueSoonWindow) {
      status = "DUE_SOON";
    } else {
      status = "CURRENT";
    }

    return { status, daysOverdue, overdueAmount, overdueInstallments, nextDueDate };
  },

  /** Maps a delinquency status onto the servicing loan status it implies. */
  toLoanStatus(status: DelinquencyStatus): LoanStatus {
    switch (status) {
      case "CURRENT":
        return "ACTIVE";
      case "DUE_SOON":
        return "DUE_SOON";
      case "DUE":
        return "DUE";
      case "OVERDUE":
        return "OVERDUE";
    }
  },
};
