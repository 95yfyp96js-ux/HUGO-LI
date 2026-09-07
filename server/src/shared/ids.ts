import { randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

/** Human-facing sequential-looking numbers, e.g. CUS-000123. Not a security control. */
export function formatSequenceNumber(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(6, "0")}`;
}
