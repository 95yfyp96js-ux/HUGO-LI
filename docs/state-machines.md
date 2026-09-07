# State Machines

Status is never assigned directly anywhere in the codebase. Every transition
goes through a machine that owns the legal-transition table, and an illegal
transition throws `INVALID_STATE_TRANSITION` (HTTP 409).

## LendingApplication

```
DRAFT ──► SUBMITTED ──► UNDER_REVIEW ──► APPROVED
  │           │              │      └──► REJECTED
  │           │              └──► RISK_REVIEW ──► APPROVED / REJECTED
  │           ├──► RISK_REVIEW          (automated underwriting refers direct)
  │           └──► EXPIRED
  └──► CANCELLED
```

`APPROVED`, `REJECTED`, `CANCELLED` and `EXPIRED` are terminal. An
application cannot be un-rejected; a new decision needs a new application.

Submitting runs the underwriting pipeline and lands in `UNDER_REVIEW` when
risk says `AUTO_APPROVE`, or `RISK_REVIEW` when a human must look. It never
lands in `APPROVED` — approval is always a person.

## Loan

```
CREATED ──► APPROVED ──► READY_FOR_DISBURSEMENT ──► DISBURSED ──► ACTIVE
   │            │                   │                              │
   └────────────┴───────────────────┴──► CANCELLED                 │
                                                                   ▼
                    ┌──────────── servicing states ────────────────┐
                    │  ACTIVE ⇄ DUE_SOON ⇄ DUE ⇄ OVERDUE          │
                    │     └──► DEFAULTED                          │
                    └──────────┬──────────────────────────────────┘
                               ├──► PAID_OFF      (terminal)
                               └──► RESTRUCTURED  (terminal, renewal)
```

Servicing states move freely between one another because `OverdueEngine`
re-derives them from the schedule and the clock: a payment can cure an
overdue loan back to `ACTIVE`, and time can push it the other way.

`PAID_OFF`, `CANCELLED` and `RESTRUCTURED` are terminal — a settled loan's
history can never be reopened by a status change. The only way back from a
`PAID_OFF` reached in error is reversing the payment that settled it, which
is itself an audited, ledger-appending operation.

A loan cannot be cancelled once money has left (`ACTIVE`, `DISBURSED`).

## Collection case

```
OPEN ──► IN_PROGRESS ──► PROMISE_TO_PAY ──► PAID ──► CLOSED
             └──► ESCALATED
```

Logging any contact moves `OPEN` to `IN_PROGRESS`. A payment that clears the
balance moves the case to `PAID` automatically.

## Disbursement / Payment

`Disbursement`: `PENDING → PROCESSING → COMPLETED | FAILED | CANCELLED`
`Payment`: `PENDING → CONFIRMED → REVERSED` (reversal appends an event; the
payment row is retained).
