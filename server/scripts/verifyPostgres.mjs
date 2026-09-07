/**
 * PostgreSQL compatibility check.
 *
 * Takes the canonical schema, swaps only the datasource provider, applies it
 * to a real PostgreSQL database, and asserts the semantics money depends on:
 * unique idempotency keys, transaction rollback, integer range, and the
 * case-sensitivity of search.
 *
 * It adds no infrastructure: without POSTGRES_TEST_URL it prints how to run
 * it and exits successfully, so it never becomes a CI dependency.
 *
 *   POSTGRES_TEST_URL=postgresql://user@host:5432/db \
 *     node scripts/verifyPostgres.mjs
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const url = process.env.POSTGRES_TEST_URL;
if (!url) {
  console.log("POSTGRES_TEST_URL is not set — skipping the PostgreSQL compatibility check.");
  console.log("Run it with: POSTGRES_TEST_URL=postgresql://... node scripts/verifyPostgres.mjs");
  process.exit(0);
}

const PG_SCHEMA = "prisma/postgres/schema.prisma";
const CLIENT_OUT = "../../node_modules/.prisma/pg-client";

// Only the provider changes. If this ever needs more, the schema has stopped
// being portable and that is the finding.
const canonical = readFileSync("prisma/schema.prisma", "utf8");
const swapped = canonical
  .replace('provider = "sqlite"', 'provider = "postgresql"')
  .replace(
    'generator client {\n  provider = "prisma-client-js"\n}',
    `generator client {\n  provider = "prisma-client-js"\n  output   = "${CLIENT_OUT}"\n}`
  );
mkdirSync(dirname(PG_SCHEMA), { recursive: true });
writeFileSync(PG_SCHEMA, swapped);

const env = { ...process.env, DATABASE_URL: url };
execSync(`npx prisma db push --schema ${PG_SCHEMA} --skip-generate --accept-data-loss`, { env, stdio: "pipe" });
execSync(`npx prisma generate --schema ${PG_SCHEMA}`, { env, stdio: "pipe" });

const { PrismaClient } = await import("../node_modules/.prisma/pg-client/index.js");
const db = new PrismaClient({ datasources: { db: { url } } });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const suffix = Date.now().toString(36);
const customer = await db.customer.create({
  data: {
    customerNumber: `PGC-${suffix}`,
    name: "Alice Wang",
    identityNumber: `PG${suffix}`,
    dateOfBirth: new Date("1990-01-01"),
    phone: "0912345678",
  },
});
const product = await db.loanProduct.create({
  data: {
    productCode: `PGP-${suffix}`,
    name: "pg",
    minAmountCents: 1,
    maxAmountCents: 100_000_000,
    minTermMonths: 1,
    maxTermMonths: 12,
    ratePercent: 1,
    rateUnit: "MONTHLY",
    calculationMethod: "SIMPLE_INTEREST",
    repaymentMethod: "INTEREST_ONLY",
  },
});
const application = await db.lendingApplication.create({
  data: {
    applicationNumber: `PGA-${suffix}`,
    customerId: customer.id,
    requestedProductId: product.id,
    requestedAmountCents: 100,
    requestedTermMonths: 1,
  },
});
const loan = await db.loan.create({
  data: {
    loanNumber: `PGL-${suffix}`,
    customerId: customer.id,
    applicationId: application.id,
    productId: product.id,
    principalCents: 100,
    outstandingPrincipalCents: 100,
    outstandingInterestCents: 0,
  },
});

const payment = (n, key) => ({
  paymentNumber: `PGPM-${suffix}-${n}`,
  loanId: loan.id,
  customerId: customer.id,
  amountCents: 10,
  method: "CASH",
  idempotencyKey: key,
  paidAt: new Date(),
  createdBy: "verify",
});

await db.payment.create({ data: payment(1, `dup-${suffix}`) });
let duplicated = false;
try {
  await db.payment.create({ data: payment(2, `dup-${suffix}`) });
  duplicated = true;
} catch (error) {
  check("duplicate idempotency key is refused by the database", error.code === "P2002", error.code);
}
if (duplicated) check("duplicate idempotency key is refused by the database", false, "a second payment was written");

const before = await db.payment.count();
try {
  await db.$transaction(async (tx) => {
    await tx.payment.create({ data: payment(3, `rollback-${suffix}`) });
    throw new Error("deliberate");
  });
} catch {
  /* expected */
}
check("a failed transaction leaves nothing behind", (await db.payment.count()) === before);

let overflowed = false;
try {
  await db.loan.create({
    data: {
      loanNumber: `PGOVER-${suffix}`,
      customerId: customer.id,
      applicationId: application.id,
      productId: product.id,
      principalCents: 2_147_483_648, // 2^31
      outstandingPrincipalCents: 0,
      outstandingInterestCents: 0,
    },
  });
  overflowed = true;
} catch {
  check("money columns reject values beyond the documented 2^31 cent ceiling", true);
}
if (overflowed) check("money columns reject values beyond the documented 2^31 cent ceiling", false, "accepted");

// The known behavioural difference, asserted rather than assumed.
const lower = await db.customer.findMany({ where: { name: { contains: "alice" } } });
const exact = await db.customer.findMany({ where: { name: { contains: "Alice" } } });
check(
  "search is CASE-SENSITIVE on PostgreSQL (case-insensitive on SQLite)",
  lower.length === 0 && exact.length > 0,
  `lowercase matches: ${lower.length}, exact matches: ${exact.length}`
);

await db.$disconnect();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exit(1);
