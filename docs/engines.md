# Engines

Every rule with financial consequences lives in one of these. They are pure —
no database, no clock of their own, no HTTP — which is why they carry the bulk
of the test suite.

---

## InterestEngine
`modules/repayment/domain/interestEngine.ts`

Supports `DAILY`, `MONTHLY`, `ANNUAL` rate units and `SIMPLE_INTEREST` in v1.
`AMORTIZED`, `COMPOUND` and `CUSTOM` are declared in the type and throw a
clear "not implemented in v1" error rather than silently mis-pricing.

Period conventions:
- `DAILY` — per elapsed day
- `MONTHLY` — whole months plus a `/30` pro-rata part month
- `ANNUAL` — actual/365

The monthly convention exists so `InterestEngine` and `RepaymentEngine` agree
about the same loan; a test asserts they do (decision-log #5).

```
50,000 @ 2.5%/month, 2026-01-01 → 2026-04-01
  → interest 3,750.00, total 53,750.00, days 90, months 3
```

## RepaymentEngine
`modules/repayment/domain/repaymentEngine.ts`

Generates the schedule. Rounding remainders always land on the final
installment, so the principal always sums back to exactly the amount lent.

| Method | Behaviour |
|---|---|
| `INTEREST_ONLY` | Interest each month on full principal; principal in the final installment |
| `PRINCIPAL_AND_INTEREST` | Equal principal, interest on the declining balance |
| `PRINCIPAL_ONLY` | Equal principal, no interest |
| `BULLET` | One installment at maturity: principal + whole-term interest |
| `CUSTOM` | Not implemented in v1 |

## RiskEngine
`modules/risk/domain/riskEngine.ts` · version `rule-based-v1`

Starts at 100 and subtracts rule penalties. Grades: A ≥85, B ≥70, C ≥55,
D ≥40, E below. Decisions: `AUTO_APPROVE` (A/B), `REVIEW_REQUIRED` (C),
`HIGH_RISK` (D), `REJECT` (E, or any blocked customer).

| Rule | Max penalty |
|---|---|
| `CUSTOMER_STATUS` | 100 (blocked) |
| `DEBT_TO_INCOME` | 60 (above 1.5×) |
| `CURRENTLY_OVERDUE` | 40 |
| `LATE_PAYMENT_HISTORY` | 25 |
| `AVERAGE_DAYS_LATE` | 20 |
| `CURRENT_EXPOSURE` | 20 |
| `REPAYMENT_TRACK_RECORD` | 8, or **−10** for a proven repayer |

Every factor is stored with its point contribution, so any decline can be
explained line by line. The `RiskModel` interface is the seam for a future
bureau or ML model — which may produce an assessment but may never mutate a
loan.

## LendingLimitEngine
`modules/risk/domain/lendingLimitEngine.ts` · version `limit-rules-v1`

```
maximumLimit    = monthlyIncome × multiple(grade), capped at product maximum
availableLimit  = maximumLimit − currentExposure   (never negative)
decision        = requested > available ? LIMIT_EXCEEDED : LIMIT_AVAILABLE
recommended     = min(requested, available), or 0 if below product minimum
```

Income multiples: A 6×, B 4×, C 3×, D 1.5×, E 0. Without verified income a
per-grade flat ceiling applies (A 50,000 … E 0). Every decision carries its
reasons.

## PricingEngine
`modules/pricing/domain/pricingEngine.ts` · version `pricing-rules-v1`

`rate = product base rate + risk premium (A 0, B 0.25, C 0.5, D 1.0, E 2.0)`,
less a 0.25 collateral discount when collateral fully covers the loan, and
never below the product's base rate.

Interest is taken from the schedule the borrower will actually be held to, so
the offer and the schedule can never disagree. Fees are `FLAT` or
`PERCENT_OF_PRINCIPAL`. Pricing outside the product's amount or term range
throws `PRICING_UNAVAILABLE` rather than inventing terms.

## AllocationEngine
`modules/payment/domain/allocationEngine.ts`

Waterfall: **interest → fees → principal**, then oldest unpaid installment
first. Overpayment surfaces as `unallocated` rather than vanishing into
principal. The engine asserts
`interest + fee + principal + unallocated == payment` and throws if it ever
fails to reconcile.

## BalanceEngine
`modules/loan/domain/balanceEngine.ts`

Projects a balance by replaying `MoneyEvent`s. Disbursement and accrual
increase; payments decrease by allocation; `PAYMENT_REVERSAL` adds back
exactly; settlement and write-off zero the position. Stored balances must
always match this replay — `scripts/reconcile.ts` checks the whole book.

## OverdueEngine
`modules/loan/domain/overdueEngine.ts`

A pure function of (schedule, currentDate). Delinquency is aged from the
**oldest** unpaid installment. Statuses: `CURRENT`, `DUE_SOON` (within 7
days), `DUE` (today), `OVERDUE` (past). A partially paid installment still
counts as overdue. Taking the date as an argument is what makes the
MockClock-driven tests possible.

## CollectionEngine
`modules/collection/domain/collectionEngine.ts`

Opens a case at 1+ days overdue. Priority by age and size — 90+ days is
always `CRITICAL`; a balance at or above 100,000 escalates the band. Priority
sets the follow-up interval (CRITICAL 1 day → LOW 14). A payment clearing the
balance moves the case to `PAID`.

## PortfolioEngine
`modules/portfolio/application/portfolioService.ts`

Computes every KPI from underlying rows — there are no stored aggregates, so
no number can drift from the loans that produced it. `PAR7/30/60/90` is the
outstanding balance of loans more than N days late, with ratios against the
total book. Also disbursement/collection by day, month and today, average
loan size, average days late, collection rate, and the risk-grade split.
