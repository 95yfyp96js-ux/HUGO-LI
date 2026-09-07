import { describe, expect, it } from "vitest";
import { BalanceEngine, type LedgerEntry } from "../../src/modules/loan/domain/balanceEngine.js";
import { Money } from "../../src/shared/money.js";

const m = (v: number) => Money.fromMajorUnits(v);

describe("BalanceEngine", () => {
  it("projects a freshly disbursed loan", () => {
    const balance = BalanceEngine.project([
      { type: "DISBURSEMENT", amount: m(50000) },
      { type: "INTEREST_ACCRUAL", amount: m(3750) },
    ]);
    expect(balance.outstandingPrincipal.toMajorUnitsString()).toBe("50000.00");
    expect(balance.outstandingInterest.toMajorUnitsString()).toBe("3750.00");
    expect(balance.totalOutstanding.toMajorUnitsString()).toBe("53750.00");
    expect(balance.totalPaid.isZero()).toBe(true);
  });

  // Spec §58: partial payment reduces the right buckets.
  it("applies a payment across interest and principal", () => {
    const balance = BalanceEngine.project([
      { type: "DISBURSEMENT", amount: m(50000) },
      { type: "INTEREST_ACCRUAL", amount: m(1250) },
      {
        type: "PAYMENT",
        amount: m(10000),
        allocation: { interest: m(1250), fee: m(0), principal: m(8750) },
      },
    ]);
    expect(balance.outstandingInterest.isZero()).toBe(true);
    expect(balance.outstandingPrincipal.toMajorUnitsString()).toBe("41250.00");
    expect(balance.totalPaid.toMajorUnitsString()).toBe("10000.00");
    expect(balance.principalPaid.toMajorUnitsString()).toBe("8750.00");
    expect(balance.interestPaid.toMajorUnitsString()).toBe("1250.00");
  });

  // Spec §25: a reversal is a new event, never a deletion.
  it("restores the balance exactly when a payment is reversed", () => {
    const beforePayment: LedgerEntry[] = [
      { type: "DISBURSEMENT", amount: m(50000) },
      { type: "INTEREST_ACCRUAL", amount: m(1250) },
    ];
    const payment: LedgerEntry = {
      type: "PAYMENT",
      amount: m(10000),
      allocation: { interest: m(1250), fee: m(0), principal: m(8750) },
    };
    const reversal: LedgerEntry = {
      type: "PAYMENT_REVERSAL",
      amount: m(10000),
      allocation: { interest: m(1250), fee: m(0), principal: m(8750) },
    };

    const original = BalanceEngine.project(beforePayment);
    const afterReversal = BalanceEngine.project([...beforePayment, payment, reversal]);

    expect(afterReversal.totalOutstanding.equals(original.totalOutstanding)).toBe(true);
    expect(afterReversal.totalPaid.isZero()).toBe(true);
  });

  it("zeroes everything on settlement", () => {
    const balance = BalanceEngine.project([
      { type: "DISBURSEMENT", amount: m(50000) },
      { type: "INTEREST_ACCRUAL", amount: m(3750) },
      { type: "SETTLEMENT", amount: m(53750) },
    ]);
    expect(balance.totalOutstanding.isZero()).toBe(true);
  });

  it("charges fees into their own bucket", () => {
    const balance = BalanceEngine.project([
      { type: "DISBURSEMENT", amount: m(10000) },
      { type: "FEE_CHARGE", amount: m(300) },
    ]);
    expect(balance.outstandingFees.toMajorUnitsString()).toBe("300.00");
    expect(balance.outstandingPrincipal.toMajorUnitsString()).toBe("10000.00");
  });

  it("is a pure replay — same events always give the same balance", () => {
    const events: LedgerEntry[] = [
      { type: "DISBURSEMENT", amount: m(50000) },
      { type: "INTEREST_ACCRUAL", amount: m(1250) },
      { type: "PAYMENT", amount: m(5000), allocation: { interest: m(1250), fee: m(0), principal: m(3750) } },
    ];
    const first = BalanceEngine.project(events);
    const second = BalanceEngine.project(events);
    expect(first.totalOutstanding.equals(second.totalOutstanding)).toBe(true);
  });

  it("refuses a payment event with no allocation", () => {
    expect(() => BalanceEngine.project([{ type: "PAYMENT", amount: m(100) }])).toThrow(/requires an allocation/);
  });
});
