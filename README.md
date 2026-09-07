# Small Lending OS v1.0

A lending operations system: the complete digital workflow for a private
small-loan book, from enquiry to settlement.

```
Customer → Application → Risk → Limit → Pricing → Approval
        → Loan → Disbursement → Servicing → Payment
        → Overdue → Collection → Renewal / Extension → Settlement → Portfolio
```

This is not a loan CRUD app. The lifecycle above is the system: risk scoring,
limit setting, pricing, interest, schedules, payment allocation, delinquency,
collections and the money ledger are each modelled explicitly, and the UI
performs no financial calculation of its own.

## Quick start

```bash
npm install

# database + demo data
cd server && npx prisma migrate deploy && npm run seed && cd ..

# two terminals
npm run dev:server     # API on :4000
npm run dev:web        # UI on :5173
```

Sign in with `admin@lending.local` / `Password123!` (development only — the
seed password comes from `SEED_PASSWORD`).

Demo users, one per role: `admin@`, `manager@`, `officer@`, `collector@`,
`auditor@` `lending.local`. Signing in as each shows how permissions change
what is available.

## Commands

| Command | What it does |
|---|---|
| `npm test` | 116 unit + integration + API tests |
| `npm run test:e2e` | 14 Playwright tests, desktop + mobile viewports |
| `npm run typecheck` | Type-checks both workspaces |
| `npm run lint` | Lints both workspaces |
| `npm run build` | Builds API and UI |
| `npm run seed` | Rebuilds the demo portfolio |
| `npm run reconcile --workspace server` | Replays every loan's ledger and checks it against stored balances |

## Layout

```
server/    Express API, domain engines, Prisma schema, tests
web/       React UI (desktop + mobile), Playwright E2E
docs/      Architecture, domain, engines, API, database, security, testing, decision log
```

## Principles this build holds to

**The UI never calculates money.** Every amount, rate, schedule and KPI comes
from a backend engine. `web/src/lib/format.ts` formats; it does not compute.

**Balances are a projection, not the truth.** The append-only `MoneyEvent`
ledger is the source of truth. Stored balances exist for speed and must
always be reproducible from the ledger — `npm run reconcile` proves it across
the whole book.

**History is appended, never rewritten.** Reversing a payment writes a
`PAYMENT_REVERSAL`. Renewing a loan creates a new loan and leaves the old
one's history untouched. Repricing a product creates a new version rather
than editing live contracts. Loan terms are frozen in an immutable
`LoanSnapshot` at creation.

**Status changes go through state machines.** No code anywhere assigns
`loan.status = "OVERDUE"`.

**Time is injected.** Nothing in the domain calls `new Date()`; a `Clock` is
passed in, which is why delinquency can be tested deterministically and the
seed can age a portfolio through real history.

**Permissions are enforced on the server.** The UI hides what a user cannot
do as a courtesy; the API rejects it regardless.

Start with `docs/architecture.md`, then `docs/decision-log.md` for why things
are the way they are — including the trade-offs that still need attention
before this handles real money.
