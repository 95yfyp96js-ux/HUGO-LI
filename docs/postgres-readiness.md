# PostgreSQL Readiness

**Status: PARTIAL.** The schema applies to PostgreSQL with a one-line provider
change and the constraints money depends on hold. One behavioural difference
must be resolved before migrating, and the money columns should be widened at
the same time.

This is not a paper audit: the findings below were produced by applying the
canonical schema to a real PostgreSQL 16 server and exercising it.

Reproduce with:

```bash
POSTGRES_TEST_URL=postgresql://user@host:5432/db \
  node server/scripts/verifyPostgres.mjs
```

Without `POSTGRES_TEST_URL` the script prints how to run it and exits 0, so it
never becomes a CI dependency. `server/tests/unit/schemaPortability.test.ts`
guards the same properties statically and runs in the normal suite.

## What was verified on a real PostgreSQL 16

| Check | Result |
|---|---|
| Canonical schema applies with only the datasource provider changed | PASS |
| `Payment.idempotencyKey` / `Disbursement.idempotencyKey` uniqueness refused a duplicate (P2002) | PASS |
| A failed transaction left nothing behind | PASS |
| Money columns rejected a value beyond 2^31 cents | PASS |
| `contains` search is **case-sensitive** on PostgreSQL | PASS (and it is a problem — see below) |

## Type mapping

| Prisma | SQLite | PostgreSQL | Note |
|---|---|---|---|
| `Int` (money, `...Cents`) | INTEGER | `integer` (32-bit) | Same ~21.4M major-unit ceiling on both |
| `Float` (`ratePercent`) | REAL | `double precision` | A rate, never a stored amount |
| `String` | TEXT | `text` | JSON is stored as text on both |
| `DateTime` | NUMERIC | `timestamp without time zone` | See time zones below |
| `Boolean` | INTEGER | `boolean` | |

No `Decimal`, `Json`, `Bytes` or native `enum` is used, which is what keeps
the provider swap to one line. The portability test fails if that changes.

## Findings

### 1. Search becomes case-sensitive — must be fixed before migrating

The one genuine behavioural difference, and it is silent.

SQLite's `LIKE` is case-insensitive for ASCII, so Prisma's `contains` matches
regardless of case. PostgreSQL's `LIKE` is case-sensitive. Measured on both:

- SQLite: `email contains "CUSTOMER1@"` matches the stored
  `customer1@example.com` — **1 result**.
- PostgreSQL: `name contains "alice"` does not match `Alice Wang` — **0
  results**; `contains "Alice"` matches.

Customer search (`CustomerService.search`) covers name, customerNumber,
phone, identityNumber and loanNumber. On PostgreSQL, staff searching
`alice` or `ln-000001` would get nothing back, with no error — the worst kind
of regression.

Chinese names and numeric identifiers are unaffected, so this would surface
only for Latin-script names and emails, which makes it easy to miss in
testing and expensive to hit in production.

**Options**, in order of preference:

1. `citext` on the searchable columns, or a functional index on `lower(...)`
   with the query lowering both sides. Correct and indexable.
2. A normalised, lowercased `searchName` column maintained on write.
3. Prisma's `mode: "insensitive"` — works on PostgreSQL but is **not
   supported on SQLite**, so it would break local development and the test
   suite unless the code branches on provider. Not recommended.

Not fixed in this sprint: it is a schema change whose value only lands at
migration time, and doing it blindly is what this audit was meant to prevent.

### 2. Money columns should be widened at migration time

Both engines use 32-bit integers, capping a single amount at 2,147,483,647
cents (~21.4M major units). PostgreSQL rejects anything larger, verified.

That is comfortable for small lending and dangerous for growth. Migrating is
the natural moment to change the money columns to `BigInt`, since it is a
single migration on an empty or small book and a painful one later.

### 3. Time zones

`DateTime` maps to `timestamp without time zone`. The application writes UTC
instants throughout and the domain compares whole UTC days, so behaviour is
consistent — but a `timestamptz` column would make that explicit rather than
conventional. Worth doing with the `BigInt` migration.

### 4. Concurrency changes for the better

SQLite serialises writers, so the read-then-write windows noted in the
hardening report are narrow today. PostgreSQL allows genuine concurrency,
which makes the database-level unique constraints (idempotency keys,
one-loan-per-application, one-settlement-per-loan) the real guard rather than
a backstop. Those constraints were verified present and enforced.

## Migration checklist

1. Widen `...Cents` columns to `BigInt`; consider `timestamptz`.
2. Resolve case-insensitive search (option 1 above).
3. Swap the datasource provider and regenerate migrations.
4. Run `scripts/verifyPostgres.mjs` against the target database.
5. Run the full suite with `DATABASE_URL` pointing at PostgreSQL.
6. Re-run `npm run reconcile` on migrated data.

SQLite remains the right choice for local development and the test suite:
each test file gets its own throwaway database in milliseconds, which a
server-based engine cannot match.
