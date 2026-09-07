import { StateMachine } from "../../../shared/stateMachine.js";

export type LoanStatus =
  | "CREATED"
  | "APPROVED"
  | "READY_FOR_DISBURSEMENT"
  | "DISBURSED"
  | "ACTIVE"
  | "DUE_SOON"
  | "DUE"
  | "OVERDUE"
  | "RESTRUCTURED"
  | "DEFAULTED"
  | "PAID_OFF"
  | "CANCELLED";

const machine = new StateMachine<LoanStatus>("Loan", {
  CREATED: ["APPROVED", "READY_FOR_DISBURSEMENT", "CANCELLED"],
  APPROVED: ["READY_FOR_DISBURSEMENT", "CANCELLED"],
  READY_FOR_DISBURSEMENT: ["DISBURSED", "CANCELLED"],
  DISBURSED: ["ACTIVE"],
  // Servicing states move freely between each other as the OverdueEngine
  // re-evaluates against the clock, and any of them can settle.
  ACTIVE: ["DUE_SOON", "DUE", "OVERDUE", "PAID_OFF", "RESTRUCTURED"],
  DUE_SOON: ["ACTIVE", "DUE", "OVERDUE", "PAID_OFF", "RESTRUCTURED"],
  DUE: ["ACTIVE", "DUE_SOON", "OVERDUE", "PAID_OFF", "RESTRUCTURED"],
  OVERDUE: ["ACTIVE", "DUE_SOON", "DUE", "PAID_OFF", "RESTRUCTURED", "DEFAULTED"],
  DEFAULTED: ["RESTRUCTURED", "PAID_OFF"],
  // Terminal
  RESTRUCTURED: [],
  PAID_OFF: [],
  CANCELLED: [],
});

/** Statuses in which a loan is live and may receive payments. */
export const SERVICING_STATUSES: LoanStatus[] = ["ACTIVE", "DUE_SOON", "DUE", "OVERDUE", "DEFAULTED"];

export const LoanStateMachine = {
  assertTransition(from: LoanStatus, to: LoanStatus): void {
    machine.assertTransition(from, to);
  },
  canTransition(from: LoanStatus, to: LoanStatus): boolean {
    return machine.canTransition(from, to);
  },
  isServicing(status: LoanStatus): boolean {
    return SERVICING_STATUSES.includes(status);
  },
  isTerminal(status: LoanStatus): boolean {
    return ["PAID_OFF", "CANCELLED", "RESTRUCTURED"].includes(status);
  },
};
