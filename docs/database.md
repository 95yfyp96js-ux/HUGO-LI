# Database

Prisma 6 + SQLite. Schema: `server/prisma/schema.prisma`.

## Money columns

All amounts are `Int` columns holding **minor units** (cents), named with a
`Cents` suffix. Prisma's `Decimal` is not supported on the SQLite connector,
and integers are exact on every engine. See decision-log #3, including the
`BigInt` migration note for larger books.

## Tables

**RBAC** — `User`, `Role`, `Permission`, `UserRole`, `RolePermission`

**Customer** — `Customer`, `CustomerNote`

**Origination** — `LendingApplication`, `RiskAssessment`, `RiskFactor`,
`LendingLimit`, `LoanProduct`, `LoanOffer`, `LoanApproval`

**Loan** — `Loan`, `LoanSnapshot`, `LoanAdjustment`, `Disbursement`,
`ScheduleLine`, `InterestAccrual`

**Money** — `Payment`, `PaymentAllocation`, `MoneyEvent`

**Servicing** — `CollectionCase`, `CollectionActivity`, `PromiseToPay`,
`Renewal`, `Extension`, `Settlement`

**Support** — `Document`, `AuditLog`, `IdempotencyRecord`

## Constraints that carry meaning

| Constraint | Why |
|---|---|
| `Loan.applicationId` unique | One loan per application; renewals create their own application (decision-log #7) |
| `Disbursement.idempotencyKey` unique | A loan cannot be disbursed twice, enforced by the database rather than a check |
| `Payment.idempotencyKey` unique | Duplicate submissions cannot create a second payment |
| `LoanSnapshot.loanId` unique | Exactly one immutable terms record per loan |
| `Settlement.loanId` unique | A loan settles once |
| `LoanProduct (productCode, version)` unique | Product versioning |
| `ScheduleLine (loanId, installmentNumber)` unique | No duplicate installments |
| `Customer.identityNumber` unique | Duplicate-customer detection |

## Append-only tables

`MoneyEvent` and `AuditLog` have no update or delete path anywhere in the
application. Corrections are new rows: a `PAYMENT_REVERSAL` event, never a
deletion.

`LoanSnapshot` is written once at loan creation and never updated. Where
terms genuinely must change, `LoanAdjustment` records the change alongside
the untouched original.

## Migrations

```
npx prisma migrate dev      # create + apply during development
npx prisma migrate deploy   # apply in CI/production (used by the test harness)
```

## Portability

No SQLite-specific SQL or types are used. Moving to PostgreSQL means changing
the provider in `schema.prisma`, regenerating migrations, and — recommended
at that point — widening the money columns to `BigInt`.
