# Security

## Authentication

JWT bearer tokens, 12-hour expiry, signed with `JWT_SECRET`. Passwords are
hashed with Node's built-in `scrypt` (random 16-byte salt, 64-byte key) and
verified with `timingSafeEqual`. Login returns an identical error for an
unknown email and a wrong password, so the endpoint cannot be used to
enumerate users.

**Must be done before production:** set `JWT_SECRET` — the fallback is a
hard-coded development string and the server will happily start without it.

## Authorisation

24 permissions, five roles, an explicit role→permission matrix in
`modules/auth/domain/permissions.ts`. The matrix is deliberately flat rather
than hierarchical: with money involved, "what can a collector actually do"
should be readable at a glance.

Enforcement is **server-side** on every route via `requirePermission`. The UI
hides controls the user cannot use, but that is a courtesy — the API is
tested to reject the request regardless of what the client sends
(`invariants.test.ts` verifies a loan officer's product-pricing attempt is
refused *and* that the product is unchanged).

Notable separations: a `LOAN_OFFICER` can originate but cannot approve, price
products, or reverse a payment. An `AUDITOR` can read everything and change
nothing.

## Sensitive data

Identity numbers are masked (`A12*****89`) at every boundary that leaves the
domain: list responses, detail responses and Customer 360. The full value
stays in the database because KYC and duplicate detection need it.

Audit payloads pass through a redactor that replaces `identityNumber`,
`passwordHash`, `password` and `token` with `[REDACTED]` before writing.

No secrets are logged. The error handler logs `method`, `path` and the error
message only — never the request body — and returns a generic
`INTERNAL_ERROR` to the client so internals are not leaked.

There are no hard-coded credentials or API keys. Seed passwords come from
`SEED_PASSWORD` with a development default, and only the hash is stored.

## Financial integrity

- `Idempotency-Key` is required on payments and disbursements, enforced by a
  unique database column rather than a read-then-write check, so a race
  cannot produce two payments.
- Every multi-step financial write runs in one transaction; a partial loan or
  an unallocated payment cannot exist.
- `MoneyEvent` and `AuditLog` are append-only — no service exposes an update
  or delete path for either.
- Balances are reproducible from the ledger, and `scripts/reconcile.ts`
  verifies that across the whole book.

## Known gaps

- **No rate limiting** on login or any endpoint — brute force is not
  mitigated.
- **Tokens cannot be revoked** before expiry; disabling a user is checked on
  each request, which limits but does not eliminate the window.
- **Tokens live in `localStorage`**, so an XSS bug would expose them.
  httpOnly cookies plus CSRF protection is the hardening step.
- **No field-level encryption at rest** for identity numbers.
- **No 2FA.**
- Transport security is assumed to be terminated by a proxy; the app itself
  serves plain HTTP.
