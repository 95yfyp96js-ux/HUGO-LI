import { StateMachine } from "../../../shared/stateMachine.js";

export type ApplicationStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "RISK_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED";

const machine = new StateMachine<ApplicationStatus>("LendingApplication", {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["UNDER_REVIEW", "CANCELLED", "EXPIRED"],
  UNDER_REVIEW: ["RISK_REVIEW", "APPROVED", "REJECTED", "CANCELLED"],
  RISK_REVIEW: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: [],
  REJECTED: [],
  CANCELLED: [],
  EXPIRED: [],
});

export const ApplicationStateMachine = {
  assertTransition(from: ApplicationStatus, to: ApplicationStatus): void {
    machine.assertTransition(from, to);
  },
  canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
    return machine.canTransition(from, to);
  },
  isTerminal(status: ApplicationStatus): boolean {
    return ["APPROVED", "REJECTED", "CANCELLED", "EXPIRED"].includes(status);
  },
};
