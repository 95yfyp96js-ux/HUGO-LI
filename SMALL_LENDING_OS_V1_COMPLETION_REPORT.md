# Small Lending OS v1.0 — Completion Report

**Date:** 2026-09-07
**Branch:** `claude/small-lending-os-v1-fu62rt`
**Starting point:** an empty repository (a README, nothing else)

---

## Verification summary

| Gate | Result |
|---|---|
| Lint (server + web) | clean |
| Typecheck (server + web) | clean |
| Unit + integration + API tests | **116 passed / 116** |
| E2E (Playwright, desktop + mobile) | **14 passed / 14** |
| Build (API + UI) | success |
| Ledger reconciliation across the book | **54/54 loans reconcile exactly** |

Seed portfolio: 30 customers, 82 applications, 54 loans, 97 payments,
13 collection cases, 10 renewals, 649 audit entries — all built through the
real services, so the fixture data obeys every domain invariant.

---

## 1. Architecture

Modular monolith. One API, one database, domain modules separated by folder
and by dependency direction. Dependencies point inward: the domain layer
imports nothing from Prisma, Express or React, which is why 83 tests run
without a database.

```
Presentation (Express: routes, auth, RBAC, error model)
        ▼
Application (services: orchestration, transactions, audit)
        ▼
Domain (engines, state machines, Money, Clock — pure)
        ▼
Infrastructure (Prisma, DisbursementProvider, IdentityScanner)
        ▼
SQLite
```

Stack: TypeScript, npm workspaces, Express, Prisma 6, SQLite, React + Vite +
Tailwind, Vitest, Playwright. Chosen and justified in `docs/decision-log.md`
because the repository was empty — nothing was inherited.

Two structural commitments: **balances are a projection of an append-only
ledger**, and **loan terms are snapshotted, not referenced**.

## 2. Domain modules

`customer` · `application` · `risk` · `pricing` · `product` · `loan` ·
`repayment` · `payment` · `disbursement` · `collection` · `renewal` ·
`portfolio` · `audit` · `auth`

Each has `domain/` and `application/` layers where it owns real rules.
Modules whose rules are thin (`product`, `portfolio`) have no domain folder —
empty directories to satisfy a diagram would be noise.

## 3. Database schema

28 tables: RBAC (5), customer (2), origination (7), loan (6), money (3),
servicing (6), support (3). Money is stored as integer minor units in `Int`
columns (Prisma's `Decimal` is unsupported on SQLite; integers are exact
everywhere). No SQLite-specific features, so PostgreSQL is a provider swap.

Constraints that carry business meaning: unique `Loan.applicationId`
(one loan per application), unique idempotency keys on `Payment` and
`Disbursement` (duplicate protection enforced by the database, not a
read-then-write check), unique `LoanSnapshot.loanId`, unique
`Settlement.loanId`, unique `(productCode, version)`.

## 4. Lending workflow

Customer → Application → Risk → Limit → Pricing → Approval → Loan (+ immutable
snapshot + schedule) → Disbursement → Servicing → Payment → Overdue →
Collection → Renewal/Extension → Settlement → Portfolio.

Five distinct amounts are preserved rather than collapsed: requested,
recommended, priced, approved, and actually disbursed.

## 5. State machines

`ApplicationStateMachine` (8 states) and `LoanStateMachine` (12 states). No
code anywhere assigns a status directly; illegal transitions throw
`INVALID_STATE_TRANSITION` (409). Servicing states move freely between one
another because delinquency is re-derived from the schedule and the clock;
`PAID_OFF`, `CANCELLED` and `RESTRUCTURED` are terminal.

## 6-17. Engines

| Engine | Status | Notes |
|---|---|---|
| Risk | Implemented | Rule-based, versioned, 7 factors, every decline explainable |
| Lending Limit | Implemented | Income multiple by grade, exposure-aware, product-capped |
| Pricing | Implemented | Base rate + risk premium, collateral discount, fees |
| Approval | Implemented | Records who/what/why; conditional approvals supported |
| Disbursement | Implemented (mock provider) | `DisbursementProvider` interface; idempotent |
| Interest | Implemented (simple interest) | Daily / monthly / annual conventions |
| Schedule (Repayment) | Implemented | 4 of 5 methods; rounding lands on the final installment |
| Repayment / Allocation | Implemented | interest → fees → principal, reconciliation asserted |
| Balance | Implemented | Ledger replay; verified across the whole book |
| Overdue | Implemented | Pure function of (schedule, date); MockClock-driven |
| Collection | Implemented | Case opening, priority banding, follow-up intervals |
| Renewal / Extension | Implemented | Chain preserved; original history untouched |
| Settlement | Implemented | Automatic at zero balance; `Settlement` record + `PAID_OFF` |
| Portfolio | Implemented | PAR7/30/60/90 and all KPIs computed from rows |

## 18. API

44 REST endpoints under `/api`, unified `{code, message, details}` error
model, 20 domain error codes. `Idempotency-Key` required on payments,
disbursements, renewals and settlements. Full table in `docs/api.md`.

## 19. UI routes

All 24 spec routes implemented: dashboard, quick-actions, customers
(list/new/360), applications (list/new/detail with the approval screen), loans
(list/new wizard/detail/pending-disbursement/overdue), payments (list/new with
allocation preview), collections (list/detail), renewals, products
(list/detail), reports with CSV export, settings (users/roles/audit-logs),
login.

Desktop sidebar plus mobile bottom navigation; the quick-actions screen is
built for one-handed field use with large tap targets.

## 20. RBAC

24 permissions, 5 roles (ADMIN, MANAGER, LOAN_OFFICER, COLLECTOR, AUDITOR),
explicit flat matrix. Enforced server-side on every route. Tested: a loan
officer receives 403 on product pricing **and the product is verified
unchanged**.

## 21. Audit

23 audited actions covering the whole lifecycle. Append-only — no update or
delete path exists. Sensitive fields are redacted from payloads before
writing. Audit rows commit inside the same transaction as the change they
describe.

## 22. Security

scrypt password hashing, JWT sessions, identity numbers masked at every
boundary, no secrets logged, no hard-coded credentials, transactional
financial writes, database-enforced idempotency. Known gaps are listed
honestly in `docs/security.md` and below.

## 23. Tests

116 backend tests (83 unit, 17 integration, 16 API) and 14 E2E across two
viewports. Every numbered case in the spec is covered:

| Case | Covered by |
|---|---|
| §57 financial case | 50,000 @ 2.5%/mo × 3 → 3,750 / 53,750, engine-computed |
| §58 partial payment | Interest-first allocation, balance verified |
| §59 full settlement | Balance 0, `PAID_OFF`, `Settlement` written, further payments refused |
| §60 overdue | MockClock through 1/30/60/90 days |
| §61 renewal | Original ledger and payments proven unchanged row by row |
| §62 product version | Live loan's snapshot and schedule untouched after repricing |
| §63 duplicate payment | One payment row, balance moved once |
| §64 permissions | 403 plus verification the product did not change |
| §65 full E2E | Whole lifecycle through the real UI |

## 24. Build

Both workspaces build clean. UI bundle 330 kB (93 kB gzipped).

---

## Implementation status

### Implemented

Customer management and Customer 360 · lending applications with state
machine · rule-based risk engine with explainable factors · lending limit
engine · pricing engine with risk premium and fees · approval engine with
conditional approvals · loan creation with immutable snapshot and generated
schedule · idempotent mock disbursement · interest engine (simple interest,
three rate units) · schedule engine (4 methods) · payment engine with
allocation waterfall · append-only money ledger · balance projection and
reconciliation tool · overdue engine · collection cases, activities and
promises to pay · renewal chain · extension · settlement · portfolio
engine with PAR metrics · dashboard with drill-down · reports with CSV
export · RBAC · audit log · mock identity scanner with mandatory human
confirmation · full desktop and mobile UI · seed data · the test suite above.

### Partially implemented

- **Interest methods** — only `SIMPLE_INTEREST`. `AMORTIZED`, `COMPOUND` and
  `CUSTOM` are typed and throw an explicit "not implemented in v1" error
  rather than mis-pricing silently.
- **Repayment methods** — 4 of 5; `CUSTOM` throws.
- **Reports** — portfolio, trend and risk reports with CSV export. The spec's
  full six-report matrix with date/product/staff filters is not built out;
  Excel and PDF export are not implemented (CSV only, as the spec permits).
- **Collection assignment** — the API and data model support assigning a
  collector; there is no UI for reassignment.
- **Documents** — the `Document` table exists; there is no upload UI or file
  storage.
- **Interest accrual** — recognised in full at disbursement rather than
  periodically. See "Known limitations".
- **User/role administration** — read-only screens. Creating users and
  editing role permissions is done via seed/database.
- **Trend chart** — a lightweight inline bar chart, not a full charting
  library.

### Not implemented

- Real bank/payment integration (interface and mock only, deliberately)
- Real KYC/OCR integration (interface and mock only, deliberately)
- ML or bureau-based risk scoring (excluded by the spec; interface provided)
- E-signature, SMS/email notification delivery
- Multi-currency, multi-branch, multi-tenant
- Background job scheduler for nightly delinquency sweeps (the sweep exists as
  `POST /api/collections/sync` and must currently be triggered)

---

## Known limitations

These are the things that would matter before this handles real money.

1. **SQLite serialises writers.** Fine for a small back office; migrate to
   PostgreSQL before multi-user concurrent writing. The schema is portable.
2. **Money columns are 32-bit `Int` cents**, capping a single amount at
   ~21.4M currency units. Widen to `BigInt` for a larger book.
3. **Interest is recognised in full at disbursement**, so early settlement
   does not rebate unearned interest. This matches how these products are
   usually sold, but it is a commercial decision — if rebates are required,
   this must move to periodic accrual (decision-log #8).
4. **`JWT_SECRET` falls back to a development string** and the server starts
   without it. Set it, or fail startup.
5. **No rate limiting** anywhere, including login.
6. **JWTs cannot be revoked** before their 12-hour expiry; the user record is
   re-checked per request, which narrows but does not close the window.
7. **Tokens are stored in `localStorage`** and so are XSS-exposed; httpOnly
   cookies plus CSRF protection would be the hardening step.
8. **Renewal loans are ungraded.** A renewal creates its own application with
   no risk assessment, so renewed loans show as "—" in the risk distribution.
   Re-scoring at renewal is the obvious fix.
9. **The delinquency sweep is manual** (an endpoint, not a cron job).
10. **Identity numbers are not encrypted at rest**, only masked in transit.
11. **The `/30` part-month convention** for monthly products is a convention,
    not a legal standard; a product requiring actual-day accrual needs a new
    calculation method.
12. **No regulatory rate-cap validation.** Nothing prevents configuring a
    product above a jurisdiction's legal interest ceiling — a real deployment
    needs that check, and it is a legal question, not an engineering one.

## Technical debt

- `Customer360Service` issues one large query with deep includes; it will need
  pagination as history grows.
- `PortfolioService.summary()` loads all loans with their schedules into
  memory to compute PAR. Correct and honest, but it should become SQL
  aggregation at scale.
- Sequence numbers use `count() + 1`, which is race-prone under concurrent
  creation; a dedicated sequence or a unique retry is needed.
- Payment allocation writes one row per payment; per-installment allocation
  rows would give finer traceability.
- No API pagination cursors — offset paging only.
- The web bundle is a single 330 kB chunk; route-level code splitting is not
  set up.
- `web/src/lib/api.ts` redirects to `/login` on 401 via `window.location`,
  bypassing the router.

## Future extensions

Bank and payment-provider adapters · real KYC/OCR · bureau data and an ML
risk model behind the existing `RiskModel` interface · periodic interest
accrual with early-settlement rebates · scheduled delinquency and
notification jobs · document upload with e-signature · the full report matrix
with Excel/PDF export · user and role administration UI · dashboards per
collector · webhooks.

---

## Assessment

The lifecycle in §65 runs end to end through the real UI, and every numbered
financial case in the spec is covered by a passing test. The three defects
found during this build were found by running the system rather than by
reading it — two engines disagreeing about the cost of the same loan, a risk
model that let loyalty offset an affordability failure, and 39 form labels
that were not associated with their inputs. Each is described in the commit
history and the decision log.

What is genuinely production-shaped: the domain modelling, the ledger and its
reconciliation, the state machines, idempotency, transactionality, RBAC and
audit. What is not yet production-ready: the deployment posture (SQLite,
secrets, rate limiting, token handling) and the operational scheduling. Those
are listed above rather than glossed over — the system is a sound skeleton
for a real lending book, not a system that should take real money tomorrow.
