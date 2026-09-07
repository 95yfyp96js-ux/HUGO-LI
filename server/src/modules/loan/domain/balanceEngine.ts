import { Money } from "../../../shared/money.js";

export type MoneyEventType =
  | "DISBURSEMENT"
  | "INTEREST_ACCRUAL"
  | "FEE_CHARGE"
  | "PAYMENT"
  | "PAYMENT_REVERSAL"
  | "ADJUSTMENT"
  | "WRITE_OFF"
  | "SETTLEMENT";

export interface LedgerEntry {
  type: MoneyEventType;
  amount: Money;
  /** For PAYMENT / PAYMENT_REVERSAL, how the amount split across buckets. */
  allocation?: {
    principal: Money;
    interest: Money;
    fee: Money;
  };
}

export interface LoanBalance {
  outstandingPrincipal: Money;
  outstandingInterest: Money;
  outstandingFees: Money;
  totalOutstanding: Money;
  totalPaid: Money;
  principalPaid: Money;
  interestPaid: Money;
  feesPaid: Money;
}

/**
 * BalanceEngine — balances are a PROJECTION of the MoneyEvent ledger, never
 * the source of truth. Any stored balance column must be reproducible by
 * replaying events through this function; the reconciliation test asserts
 * exactly that.
 */
export const BalanceEngine = {
  project(entries: LedgerEntry[]): LoanBalance {
    let principal = Money.zero();
    let interest = Money.zero();
    let fees = Money.zero();
    let principalPaid = Money.zero();
    let interestPaid = Money.zero();
    let feesPaid = Money.zero();

    for (const entry of entries) {
      switch (entry.type) {
        case "DISBURSEMENT":
          principal = principal.add(entry.amount);
          break;
        case "INTEREST_ACCRUAL":
          interest = interest.add(entry.amount);
          break;
        case "FEE_CHARGE":
          fees = fees.add(entry.amount);
          break;
        case "PAYMENT": {
          const a = requireAllocation(entry);
          principal = principal.subtract(a.principal);
          interest = interest.subtract(a.interest);
          fees = fees.subtract(a.fee);
          principalPaid = principalPaid.add(a.principal);
          interestPaid = interestPaid.add(a.interest);
          feesPaid = feesPaid.add(a.fee);
          break;
        }
        case "PAYMENT_REVERSAL": {
          const a = requireAllocation(entry);
          principal = principal.add(a.principal);
          interest = interest.add(a.interest);
          fees = fees.add(a.fee);
          principalPaid = principalPaid.subtract(a.principal);
          interestPaid = interestPaid.subtract(a.interest);
          feesPaid = feesPaid.subtract(a.fee);
          break;
        }
        case "WRITE_OFF":
        case "SETTLEMENT":
          // Closes out whatever remains without counting as customer cash.
          principal = Money.zero();
          interest = Money.zero();
          fees = Money.zero();
          break;
        case "ADJUSTMENT":
          // Signed adjustment applied to principal; negative reduces balance.
          principal = principal.add(entry.amount);
          break;
      }
    }

    return {
      outstandingPrincipal: principal,
      outstandingInterest: interest,
      outstandingFees: fees,
      totalOutstanding: principal.add(interest).add(fees),
      totalPaid: principalPaid.add(interestPaid).add(feesPaid),
      principalPaid,
      interestPaid,
      feesPaid,
    };
  },
};

function requireAllocation(entry: LedgerEntry): { principal: Money; interest: Money; fee: Money } {
  if (!entry.allocation) {
    throw new Error(`Ledger entry of type ${entry.type} requires an allocation`);
  }
  return entry.allocation;
}
