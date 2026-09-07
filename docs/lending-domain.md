# Lending Domain

The system models one thing: the life of a loan from enquiry to settlement.

```
Customer → LendingApplication → Risk → Limit → Pricing → Approval
        → Loan (+Snapshot +Schedule) → Disbursement → Servicing
        → Payment → Overdue → Collection → Renewal/Extension → Settlement
        → Portfolio
```

## Aggregates

| Aggregate | Owns | Identity |
|---|---|---|
| `Customer` | profile, employment, income, notes | `customerNumber` (CUS-000001) |
| `LendingApplication` | requested terms, risk, limit, offers, approvals | `applicationNumber` (APP-000001) |
| `Loan` | snapshot, schedule, disbursements, payments, ledger | `loanNumber` (LN-000001) |
| `CollectionCase` | activities, promises to pay | `caseNumber` (COL-000001) |

A **LendingApplication is not a Loan**. The application is what the customer
asked for; the loan is the contract that resulted. Keeping them separate is
what makes it possible to answer "what did we decline, and why" — a rejected
application leaves a permanent record with its risk assessment attached.

## Application vs Loan vs Offer

- `LendingApplication.requestedAmount` — what the customer asked for
- `LendingLimit.recommendedAmount` — what the limit engine is willing to lend
- `LoanOffer.approvedAmount` — what was priced
- `LoanApproval.approvedAmount` — what a human authorised
- `Loan.principal` — what was actually contracted
- `Disbursement.amount` — what left the account

These are five different numbers and the system keeps all five. Collapsing
them would destroy the audit trail.

## Domain invariants

Enforced in code, and each is covered by a test:

1. No `LendingApplication` without a `Customer`.
2. No `Loan` without an approved `LendingApplication`.
3. A loan may only be created from an application in `APPROVED` status.
4. A loan cannot be disbursed before it is `READY_FOR_DISBURSEMENT`.
5. A loan is disbursed at most once (unique idempotency key).
6. Every `Payment` references an existing `Loan`.
7. `PaymentAllocation` totals equal the payment amount exactly.
8. `MoneyEvent` rows are never deleted or mutated.
9. `LoanSnapshot` is never updated after creation.
10. Loan status changes only via `LoanStateMachine`.
11. Payments never rewrite financial history.
12. Reversal creates a `PAYMENT_REVERSAL` event, never a delete.
13. Renewal preserves the original loan's history unchanged.
14. A settled loan accepts no further payments.
15. Every significant financial action writes an `AuditLog`.
16. Payment and disbursement endpoints require `Idempotency-Key`.
17. Multi-step financial writes run in one transaction.
18. The UI implements no financial calculation.
19. Balances are recomputable from the ledger.
20. All lending history is traceable.

## Questions the model must answer (§75)

| Question | Where |
|---|---|
| How much has this customer borrowed? | `Customer360.summary.totalBorrowed` |
| Which loans are unpaid? | `Customer360.loans` filtered by servicing status |
| How much is owed, split by principal/interest/fees? | `GET /api/loans/:id/balance` |
| How overdue, and by how many days? | `OverdueEngine` over the schedule |
| How many times have we chased them? | `CollectionCase.activities` |
| How many times have they renewed? | `GET /api/loans/:id/chain` |
| What were the terms of each borrowing? | each loan's `LoanSnapshot` |
| When did each amount move? | `MoneyEvent` ledger, ordered by `occurredAt` |
| Who approved / disbursed / collected / changed it? | `AuditLog` |
