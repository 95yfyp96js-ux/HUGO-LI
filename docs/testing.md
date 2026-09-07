# Testing

```
npm test                    # 116 unit + integration + API tests (server)
npm run test:e2e            # 14 Playwright tests, desktop + mobile
npm run reconcile --workspace server   # ledger vs stored balance, whole book
```

## Layers

**Unit (83 tests)** — the engines, with no database. `Money`, `InterestEngine`,
`RepaymentEngine`, `AllocationEngine`, `BalanceEngine`, `OverdueEngine`,
`RiskEngine`, `LendingLimitEngine`, `PricingEngine`, and both state machines.
These run in milliseconds and are where the financial rules are pinned down.

**Integration (17 tests)** — real services against a real (throwaway) SQLite
database, with a `MockClock`. Each test file gets its own database file, so
they are isolated and can drive time forward.

**API (16 tests)** — Supertest against the assembled Express app: auth,
permissions, idempotency, error model, masking.

**E2E (14 tests)** — Playwright against the running stack, on a desktop and an
iPhone viewport.

**Reconciliation** — `scripts/reconcile.ts` replays every loan's `MoneyEvent`
ledger through `BalanceEngine` and compares it with the stored balance
columns, then checks allocation sums, orphan payments and missing snapshots.
This is the check that would catch a projection drifting from the ledger.

## The spec's numbered cases

| Case | What it proves | Where |
|---|---|---|
| §57 | 50,000 @ 2.5%/mo × 3 = 3,750 interest, 53,750 payable, from the engines | `interestEngine.test.ts`, `repaymentEngine.test.ts` |
| §58 | Partial payment allocates interest-first, balance updates | `allocationEngine.test.ts`, `lendingLifecycle.test.ts` |
| §59 | Full payment settles: balance 0, `PAID_OFF`, `Settlement` written | `lendingLifecycle.test.ts` |
| §60 | MockClock drives CURRENT → DUE_SOON → DUE → OVERDUE at 1/30/60/90 days | `overdueEngine.test.ts`, `lendingLifecycle.test.ts` |
| §61 | Renewal: original history byte-for-byte unchanged, chain rooted at loan #1 | `invariants.test.ts` |
| §62 | Repricing a product leaves the live loan's snapshot and schedule untouched | `invariants.test.ts` |
| §63 | Same `Idempotency-Key` twice → one payment, balance moved once | `invariants.test.ts` |
| §64 | Loan officer gets 403 on product pricing; product verified unchanged | `invariants.test.ts` |
| §65 | Full lifecycle through the real UI | `web/e2e/lifecycle.spec.ts` |

## Conventions

Tests assert **consequences**, not that a call returned. A settlement test
checks the loan status, the balance, the `Settlement` row and that further
payments are refused — not merely that `create()` resolved.

Three defects in this build were found by tests rather than by reading code:
the two engines disagreeing on monthly interest, the DTI scoring hole, and
39 form labels that were not associated with their inputs. Two test
expectations were also wrong and were corrected in favour of the system's
behaviour, which is recorded in the commit history rather than quietly fixed.
