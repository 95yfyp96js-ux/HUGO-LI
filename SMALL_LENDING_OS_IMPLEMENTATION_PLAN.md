# Small Lending OS v1.0 — Implementation Plan

## Phase 0 result: Repository Analysis

The repository was empty at task start (`README.md` only, no `package.json`, no
source, no database, no CI). There is no existing framework, ORM, UI system,
or auth to integrate with — this is a greenfield build. Node 22 / npm 10 /
Python 3.11 are available in the environment; no external database service is
running.

## Stack decision (see docs/decision-log.md for rationale)

- Language: TypeScript (strict) everywhere.
- Monorepo: npm workspaces, two packages: `server/` (API + all domain logic)
  and `web/` (React UI, desktop + mobile responsive).
- Backend: Node.js + Express.
- Persistence: Prisma ORM + SQLite (file DB, zero external infra). Schema is
  written to be portable to PostgreSQL later (no SQLite-only features used).
- Money: stored as integer minor units (`Int`, e.g. cents) in the DB; all
  arithmetic goes through a `Money` value object backed by `decimal.js`.
  Rationale: Prisma's `Decimal` type is not supported on the SQLite
  connector, and integer minor units are float-safe by construction on any
  backend.
- Frontend: React + Vite + TypeScript + Tailwind CSS. Server state via
  React Query. No global state library — local component state + React
  Query cache is sufficient for v1 (avoids over-engineering).
- Testing: Vitest (unit + integration, backend), Supertest (API tests),
  Playwright (E2E, browser pre-installed in this environment).
- Architecture: Modular Monolith. Each domain module has
  `domain/ application/ infrastructure/ presentation/` sub-folders where it
  has enough surface area to warrant the split; trivial modules may collapse
  layers (documented per-module, not silently skipped).

## Phase sequence (per spec §48)

| Phase | Scope | Status |
|---|---|---|
| 0 | Repository analysis | DONE |
| 1 | Architecture + domain foundation | DONE |
| 2 | Database schema + repositories | DONE |
| 3 | Customer + Customer 360 | DONE |
| 4 | Lending application + state machine | DONE |
| 5 | Risk + lending limit | DONE |
| 6 | Pricing + loan offer | DONE |
| 7 | Approval + loan creation + snapshot | DONE |
| 8 | Disbursement | DONE (mock provider) |
| 9 | Interest + schedule | DONE (simple interest) |
| 10 | Payment + repayment + balance | DONE |
| 11 | Overdue + collection | DONE |
| 12 | Renewal + extension + settlement | DONE |
| 13 | Portfolio + dashboard | DONE |
| 14 | Desktop UI | DONE |
| 15 | Mobile UI | DONE |
| 16 | RBAC + audit + security | DONE |
| 17 | Full test suite | DONE (116 + 14 E2E) |
| 18 | Final QA + completion report | DONE |

Status is updated at the end of each phase in this file and reported in chat
per the phase-gate format (§49).

## Known constraint upfront

This is a single continuous engineering session, not a multi-week team
effort. The plan is to get a real, working, tested vertical slice through
every phase (the full lifecycle in §50) rather than a wide-but-shallow UI
skin. Where a page/report is not fully built out, it will be listed
explicitly as "Not Implemented" or "Partially Implemented" in the final
completion report — nothing is claimed done without a passing test or a
manual check.
