import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTLEMENT_POLICY,
  SettlementPolicyEngine,
  isSettlementPolicy,
} from "../../src/modules/repayment/domain/settlementPolicy.js";
import { Money } from "../../src/shared/money.js";

const m = (v: number) => Money.fromMajorUnits(v);

/**
 * A 50,000 loan at 2.5%/month over 3 months: 1,250 interest per installment,
 * 3,750 over the term. Settling after the first installment falls due means
 * one period earned and two unearned.
 */
const schedule = [
  { installmentNumber: 1, dueDate: new Date("2026-02-01T00:00:00Z"), interestDue: m(1250) },
  { installmentNumber: 2, dueDate: new Date("2026-03-01T00:00:00Z"), interestDue: m(1250) },
  { installmentNumber: 3, dueDate: new Date("2026-04-01T00:00:00Z"), interestDue: m(1250) },
];

const base = {
  settlementDate: new Date("2026-02-10T00:00:00Z"),
  outstandingPrincipal: m(50000),
  outstandingInterest: m(3750),
  outstandingFees: Money.zero(),
  scheduleLines: schedule,
};

describe("SettlementPolicyEngine", () => {
  it("defaults to charging the full contract interest", () => {
    expect(DEFAULT_SETTLEMENT_POLICY).toBe("FULL_CONTRACT_INTEREST");
    expect(isSettlementPolicy("FULL_CONTRACT_INTEREST")).toBe(true);
    expect(isSettlementPolicy("UNACCRUED_INTEREST_REBATE")).toBe(true);
    expect(isSettlementPolicy("SOMETHING_ELSE")).toBe(false);
  });

  describe("FULL_CONTRACT_INTEREST", () => {
    const quote = SettlementPolicyEngine.quote({ ...base, policy: "FULL_CONTRACT_INTEREST" });

    it("waives nothing", () => {
      expect(quote.rebate.isZero()).toBe(true);
    });

    it("still reports what was earned and unearned", () => {
      // Only installment 1 has fallen due by 10 February.
      expect(quote.earnedInterest.toMajorUnitsString()).toBe("1250.00");
      expect(quote.unearnedInterest.toMajorUnitsString()).toBe("2500.00");
    });

    it("charges the whole outstanding balance to close", () => {
      expect(quote.interestPayable.toMajorUnitsString()).toBe("3750.00");
      expect(quote.payoffAmount.toMajorUnitsString()).toBe("53750.00");
    });
  });

  describe("UNACCRUED_INTEREST_REBATE", () => {
    const quote = SettlementPolicyEngine.quote({ ...base, policy: "UNACCRUED_INTEREST_REBATE" });

    it("waives the interest for periods the borrower never reaches", () => {
      expect(quote.rebate.toMajorUnitsString()).toBe("2500.00");
      expect(quote.interestPayable.toMajorUnitsString()).toBe("1250.00");
    });

    it("costs the borrower less to close than the full-interest policy", () => {
      const full = SettlementPolicyEngine.quote({ ...base, policy: "FULL_CONTRACT_INTEREST" });
      expect(quote.payoffAmount.lessThan(full.payoffAmount)).toBe(true);
      expect(quote.payoffAmount.toMajorUnitsString()).toBe("51250.00");
    });
  });

  it("waives nothing once every installment has fallen due", () => {
    const atMaturity = SettlementPolicyEngine.quote({
      ...base,
      policy: "UNACCRUED_INTEREST_REBATE",
      settlementDate: new Date("2026-04-02T00:00:00Z"),
    });
    expect(atMaturity.unearnedInterest.isZero()).toBe(true);
    expect(atMaturity.rebate.isZero()).toBe(true);
    expect(atMaturity.payoffAmount.toMajorUnitsString()).toBe("53750.00");
  });

  it("waives the whole term when settling before the first installment", () => {
    const immediately = SettlementPolicyEngine.quote({
      ...base,
      policy: "UNACCRUED_INTEREST_REBATE",
      settlementDate: new Date("2026-01-05T00:00:00Z"),
    });
    expect(immediately.rebate.toMajorUnitsString()).toBe("3750.00");
    expect(immediately.payoffAmount.toMajorUnitsString()).toBe("50000.00");
  });

  it("never refunds interest the borrower has already paid", () => {
    // Two installments already paid: only 1,250 of interest is still owed,
    // so at most that can be waived even though 2,500 is unearned.
    const partlyPaid = SettlementPolicyEngine.quote({
      ...base,
      policy: "UNACCRUED_INTEREST_REBATE",
      outstandingInterest: m(1250),
    });
    expect(partlyPaid.rebate.toMajorUnitsString()).toBe("1250.00");
    expect(partlyPaid.interestPayable.isZero()).toBe(true);
    expect(partlyPaid.payoffAmount.toMajorUnitsString()).toBe("50000.00");
  });

  it("includes outstanding fees in the payoff under either policy", () => {
    for (const policy of ["FULL_CONTRACT_INTEREST", "UNACCRUED_INTEREST_REBATE"] as const) {
      const quote = SettlementPolicyEngine.quote({ ...base, policy, outstandingFees: m(500) });
      expect(
        quote.payoffAmount.equals(base.outstandingPrincipal.add(quote.interestPayable).add(m(500)))
      ).toBe(true);
    }
  });

  it("is deterministic for the same inputs", () => {
    const a = SettlementPolicyEngine.quote({ ...base, policy: "UNACCRUED_INTEREST_REBATE" });
    const b = SettlementPolicyEngine.quote({ ...base, policy: "UNACCRUED_INTEREST_REBATE" });
    expect(a.payoffAmount.equals(b.payoffAmount)).toBe(true);
  });
});
