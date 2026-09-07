# Architecture

## Shape of the system

Small Lending OS is a **modular monolith**. One deployable API, one database,
and domain modules that are separated by folder and by dependency direction
rather than by network boundary. There is no message bus, no service mesh and
no event-sourcing framework — none of those are justified at this size, and
each one would add failure modes that a lending book of this scale does not
need.

```
        Desktop browser            iPhone / mobile browser
               │                             │
               └──────────────┬──────────────┘
                              ▼
                     Presentation (Express)
             routes.ts · middleware (auth, RBAC, errors)
                              ▼
                       Application layer
      CustomerService · LendingApplicationService · ApprovalService
      LoanService · PaymentService · CollectionService
      RenewalService · PortfolioService · ProductService · AuditService
                              ▼
                          Domain layer
      InterestEngine · RepaymentEngine · RiskEngine · LendingLimitEngine
      PricingEngine · AllocationEngine · BalanceEngine · OverdueEngine
      CollectionEngine · LoanStateMachine · ApplicationStateMachine
      Money · Clock · DomainError
                              ▼
                       Infrastructure
        Prisma client · DisbursementProvider · IdentityScanner
                              ▼
                          SQLite
```

Dependencies point inward only. The domain layer imports nothing from
Prisma, Express or React; it deals in `Money`, `Clock` and plain objects. That
is what makes the engines testable without a database — 83 of the suite's
unit tests never touch one.

## Layer responsibilities

**Presentation** parses HTTP, authenticates, checks permissions, and
translates `DomainError` into the unified `{code, message, details}` body. It
contains no business rules.

**Application** orchestrates: it loads aggregates, calls domain engines,
writes results inside a transaction, and records audit entries. Services know
about persistence; they do not know how interest is computed.

**Domain** holds every business rule that has consequences for money:
interest, schedules, risk scoring, limits, pricing, payment allocation,
balance projection, delinquency, and the legal state transitions. These are
pure functions and small classes.

**Infrastructure** is where the outside world lives: the Prisma client, the
disbursement provider, the identity scanner. Both of the latter are
interfaces with mock implementations, so a real bank or KYC integration is a
new class, not a rewrite.

## Module layout

```
server/src/
  shared/            Money, Clock, DomainError, StateMachine, masking, ids
  modules/
    customer/        domain (IdentityScanner) · application (CustomerService, Customer360Service)
    application/     domain (ApplicationStateMachine) · application (LendingApplicationService, ApprovalService)
    risk/            domain (RiskEngine, LendingLimitEngine) · application (RiskService)
    pricing/         domain (PricingEngine) · application (PricingService)
    product/         application (ProductService)
    loan/            domain (LoanStateMachine, BalanceEngine, OverdueEngine) · application (LoanService)
    repayment/       domain (InterestEngine, RepaymentEngine)
    payment/         domain (AllocationEngine) · application (PaymentService)
    disbursement/    domain (DisbursementProvider + mock)
    collection/      domain (CollectionEngine) · application (CollectionService)
    renewal/         application (RenewalService, loan chain)
    portfolio/       application (PortfolioService)
    audit/           application (AuditService)
    auth/            domain (permissions) · infrastructure (password hashing) · application (AuthService)
  infrastructure/    Prisma client
  presentation/      routes, middleware
  container.ts       composition root
  app.ts / server.ts
```

Not every module needs four sub-layers. `product` and `portfolio` have no
domain folder because their rules are thin; inventing empty directories to
satisfy a diagram would be noise. Where a module does own real rules, the
domain folder exists and the rules live there.

## Composition root and injection

`container.ts` builds every service and injects two things that matter for
testability:

- **`Clock`** — nothing in the domain calls `new Date()`. Tests and the seed
  script pass a `MockClock` and wind time forward, which is how loans
  genuinely age into `DUE` and `OVERDUE` rather than being stamped with a
  status.
- **`DisbursementProvider`** — the mock returns a reference without moving
  money. A real provider implements the same interface.

The same container backs the API server, the seed script, the reconciliation
tool and the integration tests, so all four exercise identical code paths.

## Data flow of a loan

```
Customer
   └── LendingApplication (DRAFT)
         ├── submit() ──► RiskEngine ──► RiskAssessment (+ RiskFactors)
         │                LendingLimitEngine ──► LendingLimit
         │                PricingEngine ──► LoanOffer
         ├── approve() ──► LoanApproval
         └── createLoanFromApprovedApplication()
               ├── Loan (CREATED → READY_FOR_DISBURSEMENT)
               ├── LoanSnapshot   ← immutable copy of the agreed terms
               └── ScheduleLine[] ← from RepaymentEngine
                     └── disburse()
                           ├── Disbursement (idempotent)
                           ├── MoneyEvent: DISBURSEMENT, INTEREST_ACCRUAL, FEE_CHARGE
                           └── Loan → DISBURSED → ACTIVE
                                 └── payment()
                                       ├── AllocationEngine: interest → fees → principal
                                       ├── Payment + PaymentAllocation
                                       ├── MoneyEvent: PAYMENT
                                       ├── ScheduleLine updates
                                       └── balance zero? → Settlement + PAID_OFF
```

## Two structural decisions worth calling out

**Balances are a projection.** The `MoneyEvent` ledger is the source of
truth. The balance columns on `Loan` exist because reading them is cheap, but
they must always be reproducible by replaying the ledger through
`BalanceEngine`. `scripts/reconcile.ts` asserts exactly that across the whole
book, and the integration tests assert it per loan. If the two ever disagree,
the ledger wins and the projection is the bug.

**Terms are snapshotted, not referenced.** A loan does not read its rate from
its product. At creation it copies the agreed rate, term, method, fee rules
and version into an immutable `LoanSnapshot`. Repricing a product creates a
new product version and archives the old one, so no live contract can be
rewritten by an admin editing a form. This is tested directly.

See `docs/decision-log.md` for why the stack and the money representation
were chosen, and `docs/database.md` for the schema.
