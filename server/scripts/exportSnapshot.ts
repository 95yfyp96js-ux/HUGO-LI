/**
 * Exports a snapshot of every read-only API response into a single JSON file,
 * so the UI can be published as a static, read-only preview.
 *
 * The figures in the snapshot are genuine engine output — this captures what
 * the running API actually returned, it does not fabricate values. Mutating
 * endpoints are deliberately not captured; the static build refuses them.
 *
 * Run with the API listening on PORT (default 4000):
 *   npm run export:snapshot --workspace server
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const BASE = process.env.API_URL ?? "http://localhost:4000";
const OUT = process.env.SNAPSHOT_OUT ?? "../web/src/snapshotData.json";
const EMAIL = process.env.SNAPSHOT_USER ?? "admin@lending.local";
const PASSWORD = process.env.SEED_PASSWORD ?? "Password123!";

const snapshot: Record<string, unknown> = {};

async function login(): Promise<string> {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`login failed: ${response.status}`);
  const body = (await response.json()) as { token: string; user: unknown };
  snapshot["GET /api/auth/me"] = body.user;
  return body.token;
}

async function capture(token: string, path: string): Promise<unknown> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    console.warn(`  skip ${path} (${response.status})`);
    return null;
  }
  const body = await response.json();
  snapshot[`GET ${path}`] = body;
  return body;
}

async function main() {
  const token = await login();
  console.log("Capturing portfolio and dashboard…");
  await capture(token, "/api/dashboard");
  await capture(token, "/api/portfolio/summary");
  await capture(token, "/api/portfolio/by-risk-grade");
  for (const days of [7, 30, 90]) await capture(token, `/api/portfolio/trend?days=${days}`);

  console.log("Capturing customers…");
  const customers = (await capture(token, "/api/customers?take=50")) as {
    items: Array<{ id: string }>;
  };
  // The list is also fetched with no query by some screens.
  await capture(token, "/api/customers?take=25");
  await capture(token, "/api/customers?take=10");
  for (const customer of customers.items) {
    await capture(token, `/api/customers/${customer.id}`);
    await capture(token, `/api/customers/${customer.id}/360`);
  }

  console.log("Capturing loans…");
  const loans = (await capture(token, "/api/loans?take=100")) as { items: Array<{ id: string }> };
  await capture(token, "/api/loans?take=50");
  await capture(token, "/api/loans?overdue=true&take=100");
  await capture(token, "/api/loans?pendingDisbursement=true&take=100");
  for (const status of [
    "READY_FOR_DISBURSEMENT",
    "ACTIVE",
    "DUE",
    "OVERDUE",
    "RESTRUCTURED",
    "PAID_OFF",
  ]) {
    await capture(token, `/api/loans?status=${status}&take=50`);
  }
  for (const loan of loans.items) {
    await capture(token, `/api/loans/${loan.id}`);
    await capture(token, `/api/loans/${loan.id}/balance`);
    await capture(token, `/api/loans/${loan.id}/schedule`);
    await capture(token, `/api/loans/${loan.id}/events`);
    await capture(token, `/api/loans/${loan.id}/chain`);
  }

  console.log("Capturing applications…");
  const applications = (await capture(token, "/api/lending/applications?take=50")) as {
    items: Array<{ id: string }>;
  };
  await capture(token, "/api/lending/applications?take=25");
  for (const status of ["DRAFT", "UNDER_REVIEW", "RISK_REVIEW", "APPROVED", "REJECTED"]) {
    await capture(token, `/api/lending/applications?status=${status}&take=50`);
  }
  for (const application of applications.items) {
    await capture(token, `/api/lending/applications/${application.id}`);
  }

  console.log("Capturing payments, collections, renewals, products, admin…");
  await capture(token, "/api/payments?take=50");
  const collections = (await capture(token, "/api/collections?take=50")) as {
    items: Array<{ id: string }>;
  };
  await capture(token, "/api/collections?take=25");
  await capture(token, "/api/collections/dashboard");
  for (const status of ["OPEN", "IN_PROGRESS", "PROMISE_TO_PAY", "PAID", "CLOSED"]) {
    await capture(token, `/api/collections?status=${status}&take=50`);
  }
  for (const collectionCase of collections.items) {
    await capture(token, `/api/collections/${collectionCase.id}`);
  }

  await capture(token, "/api/renewals?take=50");
  await capture(token, "/api/renewals?take=25");
  const products = (await capture(token, "/api/products")) as { items: Array<{ id: string }> };
  await capture(token, "/api/products?status=ACTIVE");
  for (const product of products.items) {
    await capture(token, `/api/products/${product.id}`);
  }

  await capture(token, "/api/settings/users");
  await capture(token, "/api/settings/roles");
  await capture(token, "/api/audit-logs?take=100");
  await capture(token, "/api/audit-logs?take=50");
  for (const resource of [
    "Customer",
    "LendingApplication",
    "Loan",
    "Payment",
    "LoanProduct",
    "CollectionCase",
  ]) {
    await capture(token, `/api/audit-logs?resource=${resource}&take=100`);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  const json = JSON.stringify(snapshot);
  writeFileSync(OUT, json);

  console.log(`\nCaptured ${Object.keys(snapshot).length} responses`);
  console.log(`Written to ${OUT} (${(json.length / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
