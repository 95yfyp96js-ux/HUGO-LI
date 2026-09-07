import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createTestEnv, ctx, TEST_PASSWORD } from "../helpers/testEnv.js";
import { Money } from "../../src/shared/money.js";
import { randomUUID } from "node:crypto";

/** Drives an application all the way to a live, disbursed loan. */
async function originateLoan(
  env: Awaited<ReturnType<typeof createTestEnv>>,
  options: { amount?: number; termCount?: number; identityNumber?: string } = {}
) {
  const customer = await env.container.customers.create(
    {
      name: "測試客戶",
      identityNumber: options.identityNumber ?? `A${Math.floor(100000000 + Math.random() * 899999999)}`,
      dateOfBirth: "1990-01-01",
      phone: "0912345678",
      monthlyIncome: 80000,
    },
    ctx(env.users.userIds.LOAN_OFFICER!)
  );

  const application = await env.container.applications.create(
    {
      customerId: customer.id,
      requestedProductId: env.users.productId,
      requestedAmount: options.amount ?? 50000,
      requestedTermCount: options.termCount ?? 3,
      income: 80000,
      existingDebt: 0,
    },
    ctx(env.users.userIds.LOAN_OFFICER!)
  );

  await env.container.applications.submit(application.id, ctx(env.users.userIds.LOAN_OFFICER!));
  await env.container.approvals.approve(application.id, { reason: "ok" }, ctx(env.users.userIds.MANAGER!));
  const loan = await env.container.loans.createFromApprovedApplication(
    application.id,
    ctx(env.users.userIds.MANAGER!)
  );
  await env.container.loans.disburse(
    loan.id,
    { idempotencyKey: `disburse-${loan.id}` },
    ctx(env.users.userIds.MANAGER!)
  );

  return { customer, application, loanId: loan.id };
}

describe("Domain invariants", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeEach(async () => {
    env = await createTestEnv(new Date("2026-01-01T09:00:00Z"));
  });

  afterEach(async () => {
    await env.cleanup();
  });

  // Spec §62: repricing a product must not touch existing loans.
  it("keeps an existing loan on its original rate when the product is repriced", async () => {
    const { loanId } = await originateLoan(env);

    const snapshotBefore = await env.db.loanSnapshot.findUniqueOrThrow({ where: { loanId } });
    expect(snapshotBefore.ratePercent).toBe(2.5);

    // Reprice the product from 2.5% to 4%.
    const newVersion = await env.container.products.update(
      env.users.productId,
      { ratePercent: 4.0 },
      ctx(env.users.userIds.ADMIN!)
    );

    expect(newVersion.ratePercent).toBe(4.0);
    expect(newVersion.version).toBe(2);

    const oldProduct = await env.db.loanProduct.findUniqueOrThrow({ where: { id: env.users.productId } });
    expect(oldProduct.status).toBe("ARCHIVED");
    // The live contract is untouched.
    expect(oldProduct.ratePercent).toBe(2.5);

    const snapshotAfter = await env.db.loanSnapshot.findUniqueOrThrow({ where: { loanId } });
    expect(snapshotAfter.ratePercent).toBe(2.5);
    expect(snapshotBefore.ratePercent).toBe(snapshotAfter.ratePercent);

    // And the schedule the borrower is held to has not moved either.
    const lines = await env.db.scheduleLine.findMany({ where: { loanId } });
    const totalInterest = Money.sum(lines.map((l) => Money.fromMinorUnits(l.interestDueCents)));
    expect(totalInterest.toMajorUnitsString()).toBe("3750.00");
  });

  // Spec §61: renewal chain.
  it("renews into a new loan without altering the original's history", async () => {
    const { loanId } = await originateLoan(env);

    const beforeEvents = await env.db.moneyEvent.findMany({ where: { loanId } });
    const beforePayments = await env.db.payment.count({ where: { loanId } });

    const { renewal, newLoan } = await env.container.renewals.renew(
      loanId,
      { idempotencyKey: randomUUID(), reason: "客戶申請續借", termCount: 3 },
      ctx(env.users.userIds.MANAGER!)
    );

    const original = await env.db.loan.findUniqueOrThrow({ where: { id: loanId } });
    expect(original.status).toBe("RESTRUCTURED");
    expect(original.outstandingPrincipalCents).toBe(0);

    // The original loan's history is intact — only appended to, never edited.
    const afterEvents = await env.db.moneyEvent.findMany({ where: { loanId } });
    expect(afterEvents.length).toBe(beforeEvents.length + 1);
    const afterById = new Map(afterEvents.map((e) => [e.id, e]));
    for (const original of beforeEvents) {
      const still = afterById.get(original.id);
      expect(still, "an original ledger event disappeared").toBeDefined();
      expect(still!.amountCents).toBe(original.amountCents);
      expect(still!.type).toBe(original.type);
      expect(still!.occurredAt.getTime()).toBe(original.occurredAt.getTime());
    }
    expect(await env.db.payment.count({ where: { loanId } })).toBe(beforePayments);

    // The new loan carries the old balance forward.
    expect(newLoan.status).toBe("ACTIVE");
    expect(Money.fromMinorUnits(newLoan.principalCents).toMajorUnitsString()).toBe("53750.00");
    expect(renewal.previousLoanId).toBe(loanId);

    const chain = await env.container.renewals.getLoanChain(newLoan.id);
    expect(chain.originalLoanId).toBe(loanId);
    expect(chain.chain).toHaveLength(2);
    expect(chain.chain[0]!.sequence).toBe(0);
    expect(chain.chain[1]!.loanId).toBe(newLoan.id);
  });

  it("keeps the chain rooted at loan #1 across successive renewals", async () => {
    const { loanId } = await originateLoan(env);

    const first = await env.container.renewals.renew(
      loanId,
      { idempotencyKey: randomUUID(), reason: "第一次續借" },
      ctx(env.users.userIds.MANAGER!)
    );
    const second = await env.container.renewals.renew(
      first.newLoan.id,
      { idempotencyKey: randomUUID(), reason: "第二次續借" },
      ctx(env.users.userIds.MANAGER!)
    );

    const chain = await env.container.renewals.getLoanChain(second.newLoan.id);
    expect(chain.originalLoanId).toBe(loanId);
    expect(chain.chain).toHaveLength(3);
    expect(chain.chain.map((c) => c.sequence)).toEqual([0, 1, 2]);
  });

  // Spec §25 / §74.12: reversal appends, never deletes.
  it("reverses a payment by writing an offsetting event", async () => {
    const { loanId } = await originateLoan(env);

    const { payment } = await env.container.payments.create(
      { loanId, amount: 1250, idempotencyKey: "rev-1" },
      ctx(env.users.userIds.MANAGER!)
    );

    const balanceAfterPayment = await env.db.loan.findUniqueOrThrow({ where: { id: loanId } });
    expect(Money.fromMinorUnits(balanceAfterPayment.outstandingInterestCents).toMajorUnitsString()).toBe(
      "2500.00"
    );

    await env.container.payments.reverse(payment.id, "收款錯誤", ctx(env.users.userIds.MANAGER!));

    // The payment row still exists, marked REVERSED.
    const stored = await env.db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(stored.status).toBe("REVERSED");

    // A reversal event was appended.
    const reversals = await env.db.moneyEvent.findMany({
      where: { loanId, type: "PAYMENT_REVERSAL" },
    });
    expect(reversals).toHaveLength(1);

    // The balance is back where it started.
    const restored = await env.db.loan.findUniqueOrThrow({ where: { id: loanId } });
    expect(Money.fromMinorUnits(restored.outstandingInterestCents).toMajorUnitsString()).toBe("3750.00");

    // And the ledger projection agrees with the stored balance.
    const projected = await env.container.loans.recalculateLoanBalance(loanId);
    expect(projected.outstandingInterest.toMinorUnits()).toBe(restored.outstandingInterestCents);
    expect(projected.outstandingPrincipal.toMinorUnits()).toBe(restored.outstandingPrincipalCents);
  });

  it("refuses to create a loan from an application that is not approved", async () => {
    const customer = await env.container.customers.create(
      {
        name: "未核准客戶",
        identityNumber: "B987654321",
        dateOfBirth: "1985-01-01",
        phone: "0987654321",
        monthlyIncome: 50000,
      },
      ctx(env.users.userIds.LOAN_OFFICER!)
    );
    const application = await env.container.applications.create(
      {
        customerId: customer.id,
        requestedProductId: env.users.productId,
        requestedAmount: 30000,
        requestedTermCount: 3,
      },
      ctx(env.users.userIds.LOAN_OFFICER!)
    );

    await expect(
      env.container.loans.createFromApprovedApplication(
        application.id,
        ctx(env.users.userIds.MANAGER!)
      )
    ).rejects.toThrow(/APPROVED application/i);
  });

  it("refuses a payment larger than the outstanding balance", async () => {
    const { loanId } = await originateLoan(env);
    await expect(
      env.container.payments.create(
        { loanId, amount: 999999, idempotencyKey: "too-big" },
        ctx(env.users.userIds.MANAGER!)
      )
    ).rejects.toThrow(/exceeds the total outstanding/i);
  });
});

describe("API contract", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeEach(async () => {
    env = await createTestEnv(new Date("2026-01-01T09:00:00Z"));
  });

  afterEach(async () => {
    await env.cleanup();
  });

  async function login(role: string) {
    const response = await request(env.app)
      .post("/api/auth/login")
      .send({ email: `${role.toLowerCase()}@test.local`, password: TEST_PASSWORD })
      .expect(200);
    return response.body.token as string;
  }

  it("rejects unauthenticated requests", async () => {
    const response = await request(env.app).get("/api/customers").expect(401);
    expect(response.body.code).toBe("UNAUTHENTICATED");
  });

  it("rejects bad credentials without revealing whether the email exists", async () => {
    const unknown = await request(env.app)
      .post("/api/auth/login")
      .send({ email: "nobody@test.local", password: "whatever" })
      .expect(401);
    const wrongPassword = await request(env.app)
      .post("/api/auth/login")
      .send({ email: "admin@test.local", password: "wrong" })
      .expect(401);
    expect(unknown.body.message).toBe(wrongPassword.body.message);
  });

  // Spec §64: permissions are enforced on the server, not just hidden in the UI.
  it("forbids a loan officer from changing product pricing", async () => {
    const token = await login("LOAN_OFFICER");
    const response = await request(env.app)
      .patch(`/api/products/${env.users.productId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ ratePercent: 0.1 })
      .expect(403);

    expect(response.body.code).toBe("INSUFFICIENT_PERMISSION");
    expect(response.body.details.permission).toBe("PRODUCT_UPDATE");

    // The product really was not changed.
    const product = await env.db.loanProduct.findUniqueOrThrow({ where: { id: env.users.productId } });
    expect(product.ratePercent).toBe(2.5);
  });

  it("allows an admin to change product pricing", async () => {
    const token = await login("ADMIN");
    await request(env.app)
      .patch(`/api/products/${env.users.productId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ ratePercent: 3.0 })
      .expect(200);
  });

  it("forbids a collector from reversing a payment", async () => {
    const token = await login("COLLECTOR");
    const response = await request(env.app)
      .post("/api/payments/some-id/reverse")
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "test" })
      .expect(403);
    expect(response.body.details.permission).toBe("PAYMENT_REVERSE");
  });

  it("forbids an auditor from creating a customer but allows reading audit logs", async () => {
    const token = await login("AUDITOR");
    await request(env.app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "x", identityNumber: "C1", dateOfBirth: "1990-01-01", phone: "09" })
      .expect(403);

    await request(env.app)
      .get("/api/audit-logs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
  });

  // Spec §63: duplicate payment protection.
  it("creates only one payment for a repeated Idempotency-Key", async () => {
    const token = await login("MANAGER");
    const { loanId } = await originateLoan(env);

    const first = await request(env.app)
      .post("/api/payments")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "duplicate-key-abc123")
      .send({ loanId, amount: 1000, method: "CASH" })
      .expect(201);

    const second = await request(env.app)
      .post("/api/payments")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "duplicate-key-abc123")
      .send({ loanId, amount: 1000, method: "CASH" })
      .expect(200);

    expect(second.body.replayed).toBe(true);
    expect(second.body.payment.id).toBe(first.body.payment.id);

    const count = await env.db.payment.count({ where: { loanId } });
    expect(count).toBe(1);

    // And the balance moved only once.
    const loan = await env.db.loan.findUniqueOrThrow({ where: { id: loanId } });
    expect(Money.fromMinorUnits(loan.outstandingInterestCents).toMajorUnitsString()).toBe("2750.00");
  });

  it("requires an Idempotency-Key on payment creation", async () => {
    const token = await login("MANAGER");
    const { loanId } = await originateLoan(env);

    const response = await request(env.app)
      .post("/api/payments")
      .set("Authorization", `Bearer ${token}`)
      .send({ loanId, amount: 1000 })
      .expect(400);
    expect(response.body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("masks identity numbers in list and detail responses", async () => {
    const token = await login("MANAGER");
    await originateLoan(env, { identityNumber: "A123456789" });

    const list = await request(env.app)
      .get("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(JSON.stringify(list.body)).not.toContain("A123456789");
    expect(list.body.items[0].identityNumber).toMatch(/\*/);
  });

  it("returns the unified error model for a domain failure", async () => {
    const token = await login("MANAGER");
    const response = await request(env.app)
      .get("/api/loans/does-not-exist")
      .set("Authorization", `Bearer ${token}`)
      .expect(404);

    expect(response.body).toMatchObject({
      code: "LOAN_NOT_FOUND",
      message: expect.any(String),
      details: { loanId: "does-not-exist" },
    });
  });

  it("serves a dashboard whose KPIs trace back to real records", async () => {
    const token = await login("MANAGER");
    await originateLoan(env);

    const response = await request(env.app)
      .get("/api/dashboard")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body.summary.activeLoanCount).toBe(1);
    expect(response.body.summary.outstandingPrincipal).toBe("50000.00");
    expect(response.body.summary.totalDisbursed).toBe("50000.00");
    expect(response.body.summary.par).toHaveProperty("par30");
  });
});
