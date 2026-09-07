import { InvalidStateTransitionError } from "./errors.js";

/**
 * Generic finite state machine. Transitions are declared once as a table;
 * callers never assign a status string directly (e.g. `loan.status = "X"`),
 * they call `transition()` and the table is the single source of truth for
 * what is legal.
 */
export class StateMachine<S extends string> {
  private readonly entityName: string;
  private readonly transitions: Map<S, Set<S>>;

  constructor(entityName: string, transitions: Record<S, S[]>) {
    this.entityName = entityName;
    this.transitions = new Map(
      Object.entries(transitions).map(([from, tos]) => [from as S, new Set(tos as S[])])
    );
  }

  canTransition(from: S, to: S): boolean {
    return this.transitions.get(from)?.has(to) ?? false;
  }

  assertTransition(from: S, to: S): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidStateTransitionError(this.entityName, from, to);
    }
  }
}
