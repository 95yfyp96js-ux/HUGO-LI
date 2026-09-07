import { Money } from "../../../shared/money.js";

/**
 * What happens to interest when a loan is settled before maturity.
 *
 * This is a commercial term, not an implementation detail: it decides what
 * the borrower actually pays to close early. It therefore belongs to the
 * priced product and is frozen onto the loan's snapshot, so repricing a
 * product can never change the deal an existing borrower agreed to.
 */
export type SettlementPolicy = "FULL_CONTRACT_INTEREST" | "UNACCRUED_INTEREST_REBATE";

export const SETTLEMENT_POLICIES: SettlementPolicy[] = [
  "FULL_CONTRACT_INTEREST",
  "UNACCRUED_INTEREST_REBATE",
];

export const DEFAULT_SETTLEMENT_POLICY: SettlementPolicy = "FULL_CONTRACT_INTEREST";

export function isSettlementPolicy(value: string): value is SettlementPolicy {
  return (SETTLEMENT_POLICIES as string[]).includes(value);
}

export interface SettlementScheduleLine {
  installmentNumber: number;
  dueDate: Date;
  interestDue: Money;
}

export interface SettlementQuoteInput {
  policy: SettlementPolicy;
  settlementDate: Date;
  outstandingPrincipal: Money;
  outstandingInterest: Money;
  outstandingFees: Money;
  scheduleLines: SettlementScheduleLine[];
}

export interface SettlementQuote {
  policy: SettlementPolicy;
  /** Interest the borrower has reached the due date for. */
  earnedInterest: Money;
  /** Interest for periods the borrower will never reach by settling now. */
  unearnedInterest: Money;
  /** What the policy actually waives — zero under FULL_CONTRACT_INTEREST. */
  rebate: Money;
  /** Interest payable after the rebate. */
  interestPayable: Money;
  /** Total to close the loan today. */
  payoffAmount: Money;
}

/**
 * SettlementPolicyEngine — the single place that decides what closing a loan
 * early costs.
 *
 * "Earned" is defined by the schedule the borrower agreed to: interest on an
 * installment is earned once that installment has fallen due. Interest for
 * installments still in the future is unearned. This is a deliberate,
 * documented convention rather than daily accrual, because v1 recognises the
 * whole term's interest at disbursement (see docs/decision-log.md #8).
 */
export const SettlementPolicyEngine = {
  quote(input: SettlementQuoteInput): SettlementQuote {
    const unearned = Money.sum(
      input.scheduleLines
        .filter((line) => line.dueDate.getTime() > input.settlementDate.getTime())
        .map((line) => line.interestDue)
    );

    // Interest already paid is not refundable here: only what is still
    // outstanding can be waived.
    const unearnedOutstanding = Money.min(unearned, input.outstandingInterest);
    const earned = input.outstandingInterest.subtract(unearnedOutstanding);

    const rebate =
      input.policy === "UNACCRUED_INTEREST_REBATE" ? unearnedOutstanding : Money.zero();
    const interestPayable = input.outstandingInterest.subtract(rebate);

    return {
      policy: input.policy,
      earnedInterest: earned,
      unearnedInterest: unearnedOutstanding,
      rebate,
      interestPayable,
      payoffAmount: input.outstandingPrincipal.add(interestPayable).add(input.outstandingFees),
    };
  },
};
