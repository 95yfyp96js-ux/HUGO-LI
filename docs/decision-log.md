# Decision Log

Format: Decision · Context · Options · Chosen · Reason · Trade-offs · Date

---

## 1. Technology stack

**Context.** The repository was empty at the start of this build — a README
and nothing else. No framework, no database, no ORM, no UI system, no auth to
integrate with. Everything was a free choice, which means everything needed
justifying rather than assuming.

**Options.**
1. TypeScript + Express + Prisma + React (mainstream, boring, huge hiring pool)
2. NestJS (batteries-included DI and module system, heavier)
3. Go or Java backend (stronger typing for money, smaller JS talent overlap)
4. Rails/Django (fast CRUD, weaker domain-modelling story for this shape)

**Chosen.** TypeScript end to end: npm workspaces, Express, Prisma, React +
Vite + Tailwind, Vitest, Playwright.

**Reason.** One language across the domain engines, the API and the UI means
the `Money` type and the DTO shapes are shared vocabulary. Express is thin
enough that the architecture is visible in the code rather than in framework
conventions. NestJS would have supplied DI we did not need — a 60-line
composition root does the job.

**Trade-offs.** JavaScript has no decimal type, so money handling has to be
deliberate (see #3). Express gives us no structure for free, so layering
discipline is on us rather than enforced by the framework.

**Date.** 2026-09-07

---

## 2. SQLite rather than PostgreSQL

**Context.** No database server runs in this environment, and the product is
a single-tenant back office for a small lending book.

**Options.** PostgreSQL (needs a running service), SQLite (file, zero infra),
MySQL (same objection as Postgres).

**Chosen.** SQLite via Prisma, with a schema that uses no SQLite-only
features.

**Reason.** Zero setup for development, tests and demos: every integration
test spins up its own throwaway database file in milliseconds. The workload
— tens of thousands of loans, a handful of concurrent back-office users — is
far inside what SQLite handles well.

**Trade-offs.** SQLite serialises writers, so this will not support many
concurrent writing users. Migrating to PostgreSQL means changing the provider
and re-generating migrations; because no SQLite-specific SQL is used, that is
a configuration change rather than a redesign. **Recommendation: move to
PostgreSQL before this handles real money at multi-user scale.**

**Date.** 2026-09-07

---

## 3. Money stored as integer minor units

**Context.** The spec asks for `Decimal(18,2)`. Two constraints collided:
JavaScript numbers are IEEE-754 binary floats and cannot represent 0.1
exactly, and Prisma's `Decimal` type is **not supported on the SQLite
connector**.

**Options.**
1. `Float` columns — rejected outright; unusable for money.
2. `Decimal` columns — unavailable on SQLite.
3. Money as a decimal **string** in the database.
4. Money as an **integer count of minor units** (cents), wrapped in a `Money`
   value object backed by decimal.js for all arithmetic.

**Chosen.** Option 4. Columns are `Int` and named `...Cents`; every
calculation goes through `Money`, which uses decimal.js internally and
applies explicit half-up rounding at defined points.

**Reason.** Integers are exact by construction on any database engine, so
this survives the move to PostgreSQL unchanged and does not depend on a
connector feature. Strings would need parsing at every boundary and permit
malformed values. Concentrating rounding in one class means the rounding rule
is a single, testable decision rather than scattered arithmetic.

**Trade-offs.** Every read and write crosses a conversion boundary, and a raw
SQL query against the database sees cents, not currency units. `Int` is a
32-bit signed value, capping any single amount at ~21.4M currency units — ample
for small lending, but **a larger book must migrate these columns to `BigInt`**.
Aggregations are computed in application code where JavaScript's safe-integer
range (9 × 10^15) applies, which is far beyond any plausible portfolio.

**Date.** 2026-09-07

---

## 4. Prisma 6 rather than Prisma 7/8

**Context.** `npm view prisma` reports 8.0.0-rc as `latest` and 7.10.0 as the
newest stable. Prisma 7 removed the `url` field from the schema's datasource
block and requires driver adapters.

**Options.** Prisma 8 RC (unreleased), Prisma 7 (driver adapters, extra
native dependency), Prisma 6.19.3 (classic configuration).

**Chosen.** Prisma 6.19.3.

**Reason.** Prisma 7's adapter architecture would have added a native
`better-sqlite3` build step and more moving parts for no functional gain
here. Shipping on a release candidate for a financial system is not
defensible.

**Trade-offs.** Prisma 6 will need upgrading eventually; the migration is
mechanical (a `prisma.config.ts` and an adapter).

**Date.** 2026-09-07

---

## 5. Monthly rates priced per period, not by day count

**Context.** Two engines disagreed about the cost of the same loan. For the
spec's canonical case — 50,000 at 2.5%/month for 3 months — `InterestEngine`
converted the monthly rate to a daily rate (×12/365) and produced **3,698.63**,
while `RepaymentEngine` charged 2.5% per installment and produced **3,750.00**.

**Options.**
1. Convert everything to a daily rate (actual/365).
2. Price a monthly product in whole months, pro-rating any part month by /30.
3. Leave them different and document it.

**Chosen.** Option 2. `DAILY` products are priced per elapsed day, `ANNUAL`
on actual/365, and `MONTHLY` in whole months plus a /30 pro-rata remainder.

**Reason.** For a monthly product, "2.5% per month for 3 months" means 7.5%
to both the borrower and the contract. Option 1 makes the schedule disagree
with the interest calculation, which is a reconciliation defect waiting to
surface in production. Option 3 is not acceptable for money.

**Trade-offs.** A /30 part month is a convention, not a law; a product
demanding actual-day accrual on a monthly rate would need a new
`calculationMethod` branch. A unit test now asserts the two engines agree.

**Date.** 2026-09-07

---

## 6. Extreme debt-to-income cannot be offset by loyalty

**Context.** A test applicant with monthly obligations at 4.17× income scored
grade **B**, because the −10 bonus for a perfect repayment record cancelled
most of the capped 30-point affordability penalty.

**Options.** Remove the loyalty bonus; cap the total bonus; add a steeper DTI
tier.

**Chosen.** A DTI above 1.5 now carries 60 points, which no combination of
positive factors can offset.

**Reason.** Affordability is the strongest single predictor of default. A
good history with a previous, smaller loan says nothing about capacity to
service a loan the applicant demonstrably cannot afford. A model that lends
into that is the model that produces the defaults.

**Trade-offs.** Rule-based thresholds are blunt and will occasionally decline
a borrower with irregular but real income. That is the intended direction of
error, and `REVIEW_REQUIRED` exists so a human can look.

**Date.** 2026-09-07

---

## 7. Renewals create their own application and approval

**Context.** `Loan.applicationId` is unique — one loan per application. The
renewal flow initially reused the original application for the new loan and
hit that constraint.

**Options.**
1. Drop the unique constraint and allow many loans per application.
2. Make `applicationId` nullable and leave renewal loans unlinked.
3. Have the renewal create its own application and approval record.

**Chosen.** Option 3.

**Reason.** Invariant §74.2 says no loan may exist without an approved
application, and a renewal genuinely *is* a new credit decision on new terms
and a new schedule. Option 1 weakens an invariant to fit a flow; option 2
leaves loans with no record of who authorised them. Option 3 keeps both the
invariant and a complete authorisation trail, and the `Renewal` row still
links original → previous → new so the chain is intact.

**Trade-offs.** Renewals inflate the application count, and their
auto-created applications carry no risk assessment — so renewal loans show as
ungraded in the risk-distribution report. Re-scoring at renewal is the
logical follow-up.

**Date.** 2026-09-07

---

## 8. Interest recognised in full at disbursement

**Context.** These are fixed-term simple-interest products where the schedule
bills a known total. Interest could be accrued daily by a scheduled job, or
recognised once up front.

**Options.** Daily accrual job; monthly accrual at each installment;
recognise the scheduled total at disbursement.

**Chosen.** Recognise the full scheduled interest as one `INTEREST_ACCRUAL`
event at disbursement.

**Reason.** It is exactly what the schedule charges, it needs no background
job, and it keeps the balance and the schedule in agreement from day one.

**Trade-offs.** Early settlement does not automatically rebate unearned
interest — the borrower pays the full contracted interest. That matches how
these products are typically sold, but **if early-settlement rebates are ever
required, this must change to periodic accrual**. It is recorded here because
it is a commercial decision, not a technical detail.

**Date.** 2026-09-07

---

## 9. Payments allocate interest → fees → principal

**Context.** Allocation order determines how quickly principal amortises and
how much a delinquent borrower ultimately pays.

**Options.** Interest first; principal first; oldest-installment first;
pro-rata.

**Chosen.** Interest, then fees, then principal, applied to the oldest unpaid
installment first.

**Reason.** It is the prevailing convention in consumer lending and protects
yield on delinquent accounts. It is implemented in one place
(`AllocationEngine`), asserted in tests, and shown to the operator as a
preview before any payment is confirmed.

**Trade-offs.** It is less favourable to the borrower than principal-first.
Some jurisdictions mandate a specific order; because the rule lives in one
engine, changing it is a single edit plus a test update.

**Date.** 2026-09-07

---

## 10. Rule-based risk engine, no ML

**Context.** The spec explicitly rules out AI in v1.

**Chosen.** A versioned, deterministic rule engine that emits a score, a
grade, a decision, and the individual factors with their point contributions.

**Reason.** Every decline must be explainable to the customer and the
regulator. There is also no historical default data to train on — a model
built on nothing would be false precision. The `RiskModel` interface is the
seam where a bureau or ML model plugs in later; note that no model may mutate
a loan, it only produces an assessment a human or the approval flow acts on.

**Trade-offs.** Thresholds are judgement, not evidence. `modelVersion` is
stored on every assessment so decisions remain attributable to the rules that
produced them when the rules change.

**Date.** 2026-09-07

---

## 11. JWT sessions with scrypt password hashing

**Context.** The system needs authentication with no external identity
provider available.

**Chosen.** JWT bearer tokens (12-hour expiry) with passwords hashed using
Node's built-in `scrypt`.

**Reason.** scrypt avoids a native bcrypt/argon2 build step while remaining a
memory-hard KDF. Stateless JWTs keep the API simple.

**Trade-offs.** Tokens cannot be revoked before expiry — a disabled user
keeps a valid token until it lapses (the user record *is* re-checked on each
request, which mitigates this). The dev secret falls back to a hard-coded
string; **`JWT_SECRET` must be set in any real deployment.** Tokens are held
in `localStorage`, which is XSS-exposed; httpOnly cookies with CSRF
protection would be the hardening step.

**Date.** 2026-09-07
