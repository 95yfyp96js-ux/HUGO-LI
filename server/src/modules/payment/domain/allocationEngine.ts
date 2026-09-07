import { Money } from "../../../shared/money.js";
import { InvalidPaymentError } from "../../../shared/errors.js";

export interface OutstandingPosition {
  interest: Money;
  fees: Money;
  principal: Money;
}

export interface AllocationResult {
  interestAmount: Money;
  feeAmount: Money;
  principalAmount: Money;
  /** Money received beyond everything owed. Callers decide whether to refund or reject. */
  unallocated: Money;
}

/**
 * Allocation waterfall: interest -> fees -> principal.
 *
 * This ordering is a deliberate business rule (interest first protects yield
 * on delinquent accounts) and is asserted in tests. The invariant
 * interest + fee + principal + unallocated === payment amount always holds.
 */
export const AllocationEngine = {
  allocate(paymentAmount: Money, outstanding: OutstandingPosition): AllocationResult {
    if (!paymentAmount.isPositive()) {
      throw new InvalidPaymentError("Payment amount must be positive", {
        amount: paymentAmount.toMajorUnitsString(),
      });
    }

    let remaining = paymentAmount;

    const interestAmount = Money.min(remaining, outstanding.interest);
    remaining = remaining.subtract(interestAmount);

    const feeAmount = Money.min(remaining, outstanding.fees);
    remaining = remaining.subtract(feeAmount);

    const principalAmount = Money.min(remaining, outstanding.principal);
    remaining = remaining.subtract(principalAmount);

    const result: AllocationResult = {
      interestAmount,
      feeAmount,
      principalAmount,
      unallocated: remaining,
    };

    assertAllocationBalances(paymentAmount, result);
    return result;
  },
};

function assertAllocationBalances(paymentAmount: Money, result: AllocationResult): void {
  const total = result.interestAmount
    .add(result.feeAmount)
    .add(result.principalAmount)
    .add(result.unallocated);
  if (!total.equals(paymentAmount)) {
    // A mismatch here means a rounding bug — fail loudly rather than silently
    // writing money that does not reconcile.
    throw new InvalidPaymentError("Payment allocation does not reconcile to the payment amount", {
      paymentAmount: paymentAmount.toMajorUnitsString(),
      allocated: total.toMajorUnitsString(),
    });
  }
}
