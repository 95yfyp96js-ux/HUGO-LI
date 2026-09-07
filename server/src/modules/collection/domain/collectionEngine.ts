import { Money } from "../../../shared/money.js";

export type CollectionPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type CollectionStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "PROMISE_TO_PAY"
  | "ESCALATED"
  | "PAID"
  | "CLOSED";
export type CollectionActivityType = "PHONE" | "SMS" | "EMAIL" | "IN_PERSON" | "SYSTEM" | "OTHER";

export interface CollectionPriorityInput {
  daysOverdue: number;
  outstandingAmount: Money;
}

const HIGH_VALUE_THRESHOLD = Money.fromMajorUnits(100000);

/**
 * CollectionEngine — decides when a delinquent loan becomes a collection case
 * and how urgent it is. Prioritisation is a business rule, not a UI sort
 * order, so it lives here.
 */
export const CollectionEngine = {
  /** A case is opened once a loan is genuinely past due, not merely "due". */
  shouldOpenCase(daysOverdue: number): boolean {
    return daysOverdue >= 1;
  },

  prioritise(input: CollectionPriorityInput): CollectionPriority {
    const highValue = input.outstandingAmount.greaterThanOrEqual(HIGH_VALUE_THRESHOLD);

    if (input.daysOverdue >= 90) return "CRITICAL";
    if (input.daysOverdue >= 60) return highValue ? "CRITICAL" : "HIGH";
    if (input.daysOverdue >= 30) return "HIGH";
    if (input.daysOverdue >= 7) return highValue ? "HIGH" : "MEDIUM";
    return highValue ? "MEDIUM" : "LOW";
  },

  /** Default follow-up interval in days for a given priority. */
  nextActionIntervalDays(priority: CollectionPriority): number {
    switch (priority) {
      case "CRITICAL":
        return 1;
      case "HIGH":
        return 3;
      case "MEDIUM":
        return 7;
      case "LOW":
        return 14;
    }
  },

  /** Cases close automatically once the underlying loan owes nothing. */
  resolveStatusAfterPayment(outstandingAmount: Money, current: CollectionStatus): CollectionStatus {
    if (!outstandingAmount.isPositive()) return "PAID";
    return current === "OPEN" ? "IN_PROGRESS" : current;
  },
};
