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

---

## 12. A renewal is underwritten against its own exposure, not the loan it replaces

**Context.** Renewal now re-runs risk, limit and pricing (V1.1 P2). The
customer's exposure includes the very loan being renewed, so a naive limit
check counts the balance twice — once as existing debt and once as the
principal being requested — and refuses almost every renewal.

**Chosen.** `RiskService.currentExposure` and `calculateLimit` take an
`excludeLoanId`, and renewal passes the loan it is replacing.

**Reason.** The loan is not additional exposure; it is the exposure being
restructured. Excluding it measures what the customer will actually owe
after the renewal, which is the number the limit is about.

**Trade-offs.** The caller decides what to exclude, so a wrong caller
understates exposure. Confined to renewal, where the exclusion is provably
the loan being closed in the same transaction.

**Date.** 2026-09-07

---

## 13. Product amount bounds constrain new money, not the carried balance

**Context.** Pricing a renewal failed with `PRICING_UNAVAILABLE` whenever the
carried balance plus new advance exceeded the product maximum — including
renewals that advanced nothing.

**Chosen.** `PricingInput.carriedAmount`. With no carried amount the whole
principal must sit inside the product's range; with one, only the new money
is bound. Term bounds always apply.

**Reason.** Product limits express how much *new* credit may be extended.
A balance already lent has already passed that test; re-applying it would
make a loan unrenewable purely because it exists.

**Trade-offs.** A long renewal chain can carry a balance above the product
maximum. That is what the limit engine and risk grade are for, and the
renewal is refused there instead — a credit decision rather than a
configuration accident.

**Date.** 2026-09-07

---

## 14. PostgreSQL search is case-sensitive; the fix waits for migration

**Context.** The empirical PostgreSQL audit (V1.1 P5) found that customer
search silently returns nothing for Latin-script names on PostgreSQL, because
SQLite's `LIKE` is case-insensitive and PostgreSQL's is not.

**Chosen.** Documented in `docs/postgres-readiness.md` as a migration
blocker with a preferred remedy (`citext` or a `lower()` functional index),
and left unfixed for now.

**Reason.** Prisma's `mode: "insensitive"` is unsupported on the SQLite
connector, so adopting it would break local development and the entire test
suite. The alternatives are schema changes whose value lands only at
migration time, and applying them blind is what the audit existed to prevent.

**Trade-offs.** The defect is real and shipped. It is inert on SQLite, so it
cannot bite before the migration it is documented against.

**Date.** 2026-09-07

---

## 15. Money-moving operations are guarded by conditional writes, not read-then-write

**Context.** The V1.1 P6 audit found three operations deciding whether to act
from a value read outside the transaction that then acted on it: disbursement
(loan status), reversal (payment status), and renewal (previous loan status).
Each is a lost-update race. Concurrent renewals were in fact being stopped by
a unique loan-number collision — an accident, not a rule.

**Chosen.** Every such decision is now a conditional `updateMany` whose
`where` clause names the state it was decided against, with the affected count
asserted. Disbursement additionally records a PENDING row *before* contacting
the payout provider, and carries a `completedForLoanId` unique column so the
database itself refuses a second successful payout per loan.

**Reason.** A financial guarantee has to live where the write happens. The
ordering matters as much as the condition: a provider called before anything
durable is recorded can move money that no row accounts for, so intent is
written first and the loan is parked in `DISBURSING` until the outcome is
known.

**Trade-offs.** A crash between the provider call and the settling
transaction leaves a loan stuck in `DISBURSING` with a PENDING disbursement.
That is deliberate — it is a reconciliation queue rather than a silent loss —
but it needs an operator to resolve, and no tooling for that ships in V1.1.
Sequence numbers are still `count() + 1`, so a concurrent pair can collide on
a unique number and one request fails; it is safe (nothing is written twice)
but it surfaces as an error rather than a retry.

**Date.** 2026-09-07

---

## 16. The Idempotency-Key middleware refuses reuse but never answers a retry

**Context.** V1.1 P6 requires that the same key with a different payload be
rejected. The obvious implementation — cache the response and replay it —
was written first and broke a passing test.

**Chosen.** `IdempotencyGuard` stores only a fingerprint of method, endpoint
and canonicalised body. A mismatch is refused with `IDEMPOTENCY_KEY_REUSED`;
a match falls through to the service, which does the replay.

**Reason.** Each service already returns its original result with an accurate
`replayed` flag, computed from the row it actually wrote. A cached response
would have served a body whose `replayed: false` had since become a lie, and
would have reported the original HTTP status for a request that did no work.
Caching bodies would also mean a second store of customer data and amounts
that nothing reads.

**Trade-offs.** The middleware is a payload guard only. It does not make a
non-idempotent endpoint idempotent — the unique columns on Payment,
Disbursement, Renewal and Extension do that — so any new money-moving
endpoint still needs its own constraint. The `IdempotencyRecord` table's
`responseBody` and `statusCode` columns are consequently unused; they are
left in place because dropping columns is a destructive migration for no
benefit.

**Date.** 2026-09-07
