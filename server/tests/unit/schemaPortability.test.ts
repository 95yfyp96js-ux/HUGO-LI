import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guards the schema's portability without needing a database.
 *
 * The real PostgreSQL check lives in scripts/verifyPostgres.mjs and needs a
 * server; this catches the edits that would quietly make the schema
 * non-portable or put money back into an unsafe type, and it runs everywhere.
 */
const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");

const modelBodies = (() => {
  const bodies: Array<{ name: string; body: string }> = [];
  const re = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(schema)) !== null) {
    bodies.push({ name: match[1]!, body: match[2]! });
  }
  return bodies;
})();

const fieldLines = modelBodies.flatMap(({ name, body }) =>
  body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//") && !line.startsWith("@@"))
    .map((line) => ({ model: name, line }))
);

describe("schema portability", () => {
  it("declares exactly one datasource, so the provider is a one-line swap", () => {
    expect(schema.match(/datasource\s+\w+\s*\{/g)?.length).toBe(1);
    expect(schema).toContain('provider = "sqlite"');
  });

  it("finds the models it expects to check", () => {
    expect(modelBodies.length).toBeGreaterThan(20);
  });

  it("keeps every money field an integer count of minor units", () => {
    // Float would reintroduce binary floating point into money; Decimal is
    // unsupported on the SQLite connector. See docs/decision-log.md #3.
    const moneyFields = fieldLines.filter(({ line }) => /^\w*[Cc]ents\s/.test(line));
    expect(moneyFields.length).toBeGreaterThan(30);
    for (const { model, line } of moneyFields) {
      expect(line, `${model}: ${line}`).toMatch(/^\w+\s+Int\b/);
    }
  });

  it("never stores money in a floating point column", () => {
    const floats = fieldLines.filter(({ line }) => /^\w+\s+Float\b/.test(line));
    // These are all rates, not amounts, and are never used as a stored
    // balance — every amount goes through Money.
    for (const { model, line } of floats) {
      expect(line, `${model}: ${line}`).toMatch(
        /^(ratePercent|approvedRatePercent|maxMonthlyRatePercent)\s/
      );
    }
  });

  it("uses no type that the SQLite connector cannot express", () => {
    // Keeping to this list is what makes the provider swap a one-liner.
    for (const { model, line } of fieldLines) {
      expect(line, `${model}: ${line}`).not.toMatch(/^\w+\s+Decimal\b/);
      expect(line, `${model}: ${line}`).not.toMatch(/^\w+\s+Json\b/);
      expect(line, `${model}: ${line}`).not.toMatch(/^\w+\s+Bytes\b/);
    }
    expect(schema).not.toMatch(/\benum\s+\w+\s*\{/);
  });

  it("enforces idempotency in the database rather than in code alone", () => {
    for (const model of ["Payment", "Disbursement"]) {
      const body = modelBodies.find((m) => m.name === model)?.body ?? "";
      expect(body, model).toMatch(/idempotencyKey\s+String\s+@unique/);
    }
  });

  it("keeps the one-loan-per-application and one-settlement-per-loan guarantees", () => {
    const loan = modelBodies.find((m) => m.name === "Loan")?.body ?? "";
    expect(loan).toMatch(/applicationId\s+String\s+@unique/);

    const settlement = modelBodies.find((m) => m.name === "Settlement")?.body ?? "";
    expect(settlement).toMatch(/loanId\s+String\s+@unique/);

    const snapshot = modelBodies.find((m) => m.name === "LoanSnapshot")?.body ?? "";
    expect(snapshot).toMatch(/loanId\s+String\s+@unique/);
  });
});
