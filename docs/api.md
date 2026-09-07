# API

Base path `/api`. All endpoints except `POST /auth/login` require
`Authorization: Bearer <token>`.

## Error model

Every failure returns the same shape:

```json
{ "code": "LOAN_LIMIT_EXCEEDED", "message": "…", "details": { } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Missing or malformed token |
| `INVALID_TOKEN` / `INVALID_CREDENTIALS` | 401 | Bad session or login |
| `INSUFFICIENT_PERMISSION` | 403 | Authenticated but not allowed |
| `CUSTOMER_NOT_FOUND` / `APPLICATION_NOT_FOUND` / `LOAN_NOT_FOUND` / `PRODUCT_NOT_FOUND` / `COLLECTION_CASE_NOT_FOUND` | 404 | Unknown id |
| `INVALID_STATE_TRANSITION` | 409 | Illegal state machine move |
| `INVALID_LOAN_STATE` | 409 | Operation not valid in this status |
| `DUPLICATE_PAYMENT` | 409 | Idempotency conflict |
| `VALIDATION_ERROR` / `INVALID_PAYMENT` | 400 | Bad input |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Missing `Idempotency-Key` header |
| `RISK_REVIEW_REQUIRED` | 409 | Needs a human decision |
| `PRICING_UNAVAILABLE` / `SCHEDULE_CALCULATION_FAILED` / `LOAN_LIMIT_EXCEEDED` | 422 | Cannot produce terms |
| `INTERNAL_ERROR` | 500 | Unexpected; details never leaked |

## Endpoints

### Auth
| Method | Path | Permission |
|---|---|---|
| POST | `/auth/login` | — |
| GET | `/auth/me` | authenticated |

### Customers
| Method | Path | Permission |
|---|---|---|
| GET | `/customers?q=&status=&take=&skip=` | `CUSTOMER_READ` |
| POST | `/customers` | `CUSTOMER_CREATE` |
| GET | `/customers/:id` | `CUSTOMER_READ` |
| PATCH | `/customers/:id` | `CUSTOMER_UPDATE` |
| GET | `/customers/:id/360` | `CUSTOMER_READ` |
| POST | `/customers/identity-scan` | `CUSTOMER_CREATE` |

Identity numbers are masked in all responses. The scan endpoint **returns a
parsed result for confirmation and never creates a customer**.

### Lending applications
| Method | Path | Permission |
|---|---|---|
| GET | `/lending/applications?status=&customerId=` | `APPLICATION_READ` |
| POST | `/lending/applications` | `APPLICATION_CREATE` |
| GET | `/lending/applications/:id` | `APPLICATION_READ` |
| PATCH | `/lending/applications/:id` | `APPLICATION_UPDATE` |
| POST | `/lending/applications/:id/submit` | `APPLICATION_UPDATE` |
| POST | `/lending/applications/:id/approve` | `APPLICATION_APPROVE` |
| POST | `/lending/applications/:id/reject` | `APPLICATION_REJECT` |
| POST | `/lending/applications/:id/cancel` | `APPLICATION_UPDATE` |

`submit` runs risk → limit → pricing and returns `{application, assessment, limit, offer}`.

### Loans
| Method | Path | Permission | Idempotent |
|---|---|---|---|
| GET | `/loans?status=&overdue=&pendingDisbursement=` | `LOAN_READ` | |
| POST | `/loans` | `LOAN_CREATE` | |
| GET | `/loans/:id` | `LOAN_READ` | |
| GET | `/loans/:id/schedule` | `LOAN_READ` | |
| GET | `/loans/:id/balance` | `LOAN_READ` | recomputed from ledger |
| GET | `/loans/:id/events` | `LOAN_READ` | |
| GET | `/loans/:id/chain` | `LOAN_READ` | |
| POST | `/loans/:id/disburse` | `LOAN_DISBURSE` | **required** |
| POST | `/loans/:id/renew` | `LOAN_RENEW` | **required** |
| POST | `/loans/:id/extend` | `LOAN_EXTEND` | |
| POST | `/loans/:id/settle` | `LOAN_SETTLE` | **required** |
| POST | `/loans/:id/refresh-status` | `LOAN_READ` | |
| POST | `/loans/:id/collection-case` | `COLLECTION_UPDATE` | |

### Payments
| Method | Path | Permission | Idempotent |
|---|---|---|---|
| GET | `/payments?loanId=&customerId=` | `PAYMENT_READ` | |
| POST | `/payments/preview` | `PAYMENT_READ` | |
| POST | `/payments` | `PAYMENT_CREATE` | **required** |
| POST | `/payments/:id/reverse` | `PAYMENT_REVERSE` | |

A replayed `Idempotency-Key` returns `200` with `replayed: true` and the
original payment; a new key returns `201`.

### Collections
| Method | Path | Permission |
|---|---|---|
| GET | `/collections?status=&priority=&assignedUserId=` | `COLLECTION_READ` |
| GET | `/collections/dashboard` | `COLLECTION_READ` |
| POST | `/collections/sync` | `COLLECTION_UPDATE` |
| GET | `/collections/:id` | `COLLECTION_READ` |
| POST | `/collections/:id/activity` | `COLLECTION_UPDATE` |
| POST | `/collections/:id/promise` | `COLLECTION_UPDATE` |
| POST | `/collections/:id/assign` | `COLLECTION_UPDATE` |

### Products, portfolio, admin
| Method | Path | Permission |
|---|---|---|
| GET | `/products?status=` | `PRODUCT_READ` |
| POST | `/products` | `PRODUCT_UPDATE` |
| GET | `/products/:id` | `PRODUCT_READ` |
| PATCH | `/products/:id` | `PRODUCT_UPDATE` |
| GET | `/renewals` | `LOAN_READ` |
| GET | `/portfolio/summary` | `LOAN_READ` |
| GET | `/portfolio/by-risk-grade` | `LOAN_READ` |
| GET | `/portfolio/trend?days=` | `LOAN_READ` |
| GET | `/dashboard` | `LOAN_READ` |
| GET | `/settings/users` | `USER_MANAGE` |
| GET | `/settings/roles` | `USER_MANAGE` |
| GET | `/audit-logs?resource=&resourceId=&userId=&action=` | `AUDIT_READ` |

`PATCH /products/:id` returns a **new product version** when pricing fields
change; the response id differs from the request id.

## Money in payloads

Amounts are sent and received as decimal strings (`"53750.00"`), never
floats. Some list endpoints also expose the raw `...Cents` integers.
