import { describe, expect, it } from "vitest";
import { ApplicationStateMachine } from "../../src/modules/application/domain/applicationStateMachine.js";
import { LoanStateMachine } from "../../src/modules/loan/domain/loanStateMachine.js";

describe("ApplicationStateMachine", () => {
  it("walks the happy path DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED", () => {
    expect(ApplicationStateMachine.canTransition("DRAFT", "SUBMITTED")).toBe(true);
    expect(ApplicationStateMachine.canTransition("SUBMITTED", "UNDER_REVIEW")).toBe(true);
    expect(ApplicationStateMachine.canTransition("UNDER_REVIEW", "APPROVED")).toBe(true);
  });

  it("allows a risk referral before a decision", () => {
    expect(ApplicationStateMachine.canTransition("UNDER_REVIEW", "RISK_REVIEW")).toBe(true);
    expect(ApplicationStateMachine.canTransition("RISK_REVIEW", "APPROVED")).toBe(true);
    expect(ApplicationStateMachine.canTransition("RISK_REVIEW", "REJECTED")).toBe(true);
  });

  it("refuses to approve straight from DRAFT", () => {
    expect(ApplicationStateMachine.canTransition("DRAFT", "APPROVED")).toBe(false);
    expect(() => ApplicationStateMachine.assertTransition("DRAFT", "APPROVED")).toThrow(
      /Cannot transition LendingApplication from DRAFT to APPROVED/
    );
  });

  it("treats decided applications as terminal", () => {
    for (const status of ["APPROVED", "REJECTED", "CANCELLED", "EXPIRED"] as const) {
      expect(ApplicationStateMachine.isTerminal(status)).toBe(true);
      expect(ApplicationStateMachine.canTransition(status, "UNDER_REVIEW")).toBe(false);
    }
  });

  it("cannot un-reject an application", () => {
    expect(ApplicationStateMachine.canTransition("REJECTED", "APPROVED")).toBe(false);
  });
});

describe("LoanStateMachine", () => {
  it("walks the origination path through to ACTIVE", () => {
    expect(LoanStateMachine.canTransition("CREATED", "APPROVED")).toBe(true);
    expect(LoanStateMachine.canTransition("APPROVED", "READY_FOR_DISBURSEMENT")).toBe(true);
    // DISBURSING sits between "ready" and "disbursed": it is the claim a
    // caller takes before contacting the payout provider, so that a loan with
    // a payout possibly in flight is a state the database can hold.
    expect(LoanStateMachine.canTransition("READY_FOR_DISBURSEMENT", "DISBURSING")).toBe(true);
    expect(LoanStateMachine.canTransition("DISBURSING", "DISBURSED")).toBe(true);
    expect(LoanStateMachine.canTransition("DISBURSED", "ACTIVE")).toBe(true);
  });

  it("does not let a loan skip the disbursing claim", () => {
    // Skipping straight to DISBURSED would mean money moved without anyone
    // having taken the claim that keeps a second payout out.
    expect(LoanStateMachine.canTransition("READY_FOR_DISBURSEMENT", "DISBURSED")).toBe(false);
    expect(LoanStateMachine.canTransition("APPROVED", "DISBURSED")).toBe(false);
  });

  it("returns a claimed loan to its pre-disbursement status when the provider declines", () => {
    expect(LoanStateMachine.canTransition("DISBURSING", "READY_FOR_DISBURSEMENT")).toBe(true);
    expect(LoanStateMachine.canTransition("DISBURSING", "APPROVED")).toBe(true);
    // But it can never jump straight into servicing without being disbursed.
    expect(LoanStateMachine.canTransition("DISBURSING", "ACTIVE")).toBe(false);
  });

  it("refuses to disburse a loan that is not ready", () => {
    expect(LoanStateMachine.canTransition("CREATED", "DISBURSED")).toBe(false);
    expect(() => LoanStateMachine.assertTransition("CREATED", "DISBURSED")).toThrow(
      /Cannot transition Loan from CREATED to DISBURSED/
    );
  });

  it("moves between servicing states as delinquency changes", () => {
    expect(LoanStateMachine.canTransition("ACTIVE", "DUE_SOON")).toBe(true);
    expect(LoanStateMachine.canTransition("DUE_SOON", "DUE")).toBe(true);
    expect(LoanStateMachine.canTransition("DUE", "OVERDUE")).toBe(true);
    // A payment can cure delinquency.
    expect(LoanStateMachine.canTransition("OVERDUE", "ACTIVE")).toBe(true);
  });

  it("allows settlement from any servicing state", () => {
    for (const status of ["ACTIVE", "DUE_SOON", "DUE", "OVERDUE", "DEFAULTED"] as const) {
      expect(LoanStateMachine.canTransition(status, "PAID_OFF")).toBe(true);
      expect(LoanStateMachine.isServicing(status)).toBe(true);
    }
  });

  it("locks a paid-off loan forever", () => {
    expect(LoanStateMachine.isTerminal("PAID_OFF")).toBe(true);
    for (const target of ["ACTIVE", "OVERDUE", "DISBURSED", "CANCELLED"] as const) {
      expect(LoanStateMachine.canTransition("PAID_OFF", target)).toBe(false);
    }
  });

  it("cannot cancel a loan that is already out the door", () => {
    expect(LoanStateMachine.canTransition("ACTIVE", "CANCELLED")).toBe(false);
    expect(LoanStateMachine.canTransition("DISBURSED", "CANCELLED")).toBe(false);
  });
});
