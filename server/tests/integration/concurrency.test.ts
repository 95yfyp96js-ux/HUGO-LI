import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, ctx, TEST_PASSWORD } from "../helpers/testEnv.js";
import { originateLoan } from "../helpers/originate.js";
import { IdempotencyGuard } from "../../src/presentation/idempotency.js";

/**
 * P6: every money-moving operation is asked the same two questions — what
 * happens on a replay, and what happens when two of them run at once.
 *
 * These are not unit tests of the guards; they drive the real services and
 * then check the *ledger*, because a duplicate that leaves the balance right
 * but writes two events is still a broken book.
 */
let env: Awaited<ReturnType<typeof createTestEnv>>;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});

const managerCtx = () => ctx(env.users.userIds.MANAGER!);

async function token(role: string) {
  const res = await request(env.app)
    .post("/api/auth/login")
    .send({ email: `${role.toLowerCase()}@test.local`, password: TEST_PASSWORD })
    .expect(200);
  return res.body.token as string;
}

describe("idempotency and concurrency", () => {
  describe("disbursement", () => {
    it("pays out once when the same request is retried", async () => {
      const { loanId } = await originateLoan(env);
      // originateLoan already disbursed; retry that exact key.
      const replay = await env.container.loans.disburse(
        loanId,
        { idempotencyKey: `disburse-${loanId}` },
        managerCtx()
      );
      expect(replay.replayed).toBe(true);

      const events = await env.db.moneyEvent.findMany({ where: { loanId, type: "DISBURSEMENT" } });
      expect(events).toHaveLength(1);
    });

    it("refuses a second payout on the same loan even under a different key", async () => {
      const { loanId } = await originateLoan(env);
      // A different key defeats the idempotency column entirely: this is the
      // case that used to send real money twice.
      await expect(
        env.container.loans.disburse(loanId, { idempotencyKey: randomUUID() }, managerCtx())
      ).rejects.toThrow();

      const disbursed = await env.db.disbursement.findMany({
        where: { loanId, status: "COMPLETED" },
      });
      expect(disbursed).toHaveLength(1);
    });

    it("lets the database refuse a second completed disbursement on its own", async () => {
      const { loanId } = await originateLoan(env);
      // Bypass every service-level check and go straight at the constraint,
      // because that is the guarantee the pilot actually rests on.
      await expect(
        env.db.disbursement.create({
          data: {
            disbursementNumber: `DSB-RAW-${randomUUID().slice(0, 8)}`,
            loanId,
            amountCents: 1,
            method: "BANK_TRANSFER",
            status: "COMPLETED",
            completedForLoanId: loanId,
            idempotencyKey: randomUUID(),
          },
        })
      ).rejects.toMatchObject({ code: "P2002" });
    });

    it("sends money once when two disbursements race on the same loan", async () => {
      // The case the idempotency column cannot see and the status check used
      // to miss: two requests, two different keys, both reading the loan
      // before either had moved it. Both used to reach the payout provider.
      const { loanId } = await originateLoan(env, { skipDisbursement: true });

      const results = await Promise.allSettled([
        env.container.loans.disburse(loanId, { idempotencyKey: randomUUID() }, managerCtx()),
        env.container.loans.disburse(loanId, { idempotencyKey: randomUUID() }, managerCtx()),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

      const completed = await env.db.disbursement.findMany({
        where: { loanId, status: "COMPLETED" },
      });
      expect(completed).toHaveLength(1);

      const events = await env.db.moneyEvent.findMany({ where: { loanId, type: "DISBURSEMENT" } });
      expect(events).toHaveLength(1);

      const loan = await env.db.loan.findUniqueOrThrow({ where: { id: loanId } });
      expect(loan.status).toBe("ACTIVE");
      expect(loan.outstandingPrincipalCents).toBe(5_000_000);
    });

    it("contacts the payout provider once, even when two disbursements race", async () => {
      // The database refusing a second row is not the same as the bank
      // refusing a second transfer. This counts what the provider was
      // actually asked to send, because that is the money.
      let sends = 0;
      const counting = await createTestEnv(new Date("2026-01-01T09:00:00Z"), {
        disbursementProvider: {
          async send(request) {
            sends += 1;
            // Widen the window a real network call would open anyway.
            await new Promise((resolve) => setTimeout(resolve, 20));
            return { success: true, reference: `COUNT-${request.loanNumber}` };
          },
        },
      });
      try {
        const { loanId } = await originateLoan(counting, { skipDisbursement: true });
        await Promise.allSettled([
          counting.container.loans.disburse(
            loanId,
            { idempotencyKey: randomUUID() },
            ctx(counting.users.userIds.MANAGER!)
          ),
          counting.container.loans.disburse(
            loanId,
            { idempotencyKey: randomUUID() },
            ctx(counting.users.userIds.MANAGER!)
          ),
        ]);
        expect(sends).toBe(1);
      } finally {
        await counting.cleanup();
      }
    });

    it("holds a claimed loan so a concurrent caller cannot pay out beneath it", async () => {
      const { loanId } = await originateLoan(env);
      const loan = await env.db.loan.findUniqueOrThrow({ where: { id: loanId } });
      expect(loan.status).not.toBe("DISBURSING");

      // A loan mid-payout is parked in DISBURSING; nobody else may claim it.
      await env.db.loan.update({ where: { id: loanId }, data: { status: "DISBURSING" } });
      await expect(
        env.container.loans.disburse(loanId, { idempotencyKey: randomUUID() }, managerCtx())
      ).rejects.toThrow(/DISBURSING|state/i);
    });
  });

  describe("payment", () => {
    it("records one payment and one ledger event for a repeated key", async () => {
      const { loanId } = await originateLoan(env);
      const key = randomUUID();
      const input = { loanId, amount: 1000, method: "CASH", idempotencyKey: key };

      const first = await env.container.payments.create(input, managerCtx());
      const second = await env.container.payments.create(input, managerCtx());

      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      expect(second.payment.id).toBe(first.payment.id);

      const payments = await env.db.payment.findMany({ where: { loanId } });
      expect(payments).toHaveLength(1);
      const events = await env.db.moneyEvent.findMany({ where: { loanId, type: "PAYMENT" } });
      expect(events).toHaveLength(1);
    });

    it("takes the money only once when two identical payments race", async () => {
      const { loanId } = await originateLoan(env);
      const key = randomUUID();
      const input = { loanId, amount: 1000, method: "CASH", idempotencyKey: key };

      const before = await env.db.loan.findUniqueOrThrow({ where: { id: loanId } });
      const results = await Promise.allSettled([
        env.container.payments.create(input, managerCtx()),
        env.container.payments.create(input, managerCtx()),
      ]);

      // Both callers get an answer — the loser is served the winner's payment
      // rather than a constraint error.
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      const payments = await env.db.payment.findMany({ where: { loanId } });
      expect(payments).toHaveLength(1);

      const after = await env.db.loan.findUniqueOrThrow({ where: { id: loanId } });
      const paid =
        before.outstandingPrincipalCents +
        before.outstandingInterestCents +
        before.outstandingFeeCents -
        (after.outstandingPrincipalCents + after.outstandingInterestCents + after.outstandingFeeCents);
      expect(paid).toBe(100_000);
    });
  });

  describe("reversal", () => {
    it("credits the balance back exactly once when reversed twice", async () => {
      const { loanId } = await originateLoan(env);
      const payment = await env.container.payments.create(
        { loanId, amount: 1000, method: "CASH", idempotencyKey: randomUUID() },
        managerCtx()
      );

      await env.container.payments.reverse(payment.payment.id, "entered in error", managerCtx());
      const afterFirst = await env.db.loan.findUniqueOrThrow({ where: { id: loanId } });

      await expect(
        env.container.payments.reverse(payment.payment.id, "again", managerCtx())
      ).rejects.toThrow(/reversed|reversible/i);

      const afterSecond = await env.db.loan.findUniqueOrThrow({ where: { id: loanId } });
      expect(afterSecond.outstandingPrincipalCents).toBe(afterFirst.outstandingPrincipalCents);
      expect(afterSecond.outstandingInterestCents).toBe(afterFirst.outstandingInterestCents);

      const reversals = await env.db.moneyEvent.findMany({
        where: { loanId, type: "PAYMENT_REVERSAL" },
      });
      expect(reversals).toHaveLength(1);
    });

    it("compensates rather than deleting the original event", async () => {
      const { loanId } = await originateLoan(env);
      const payment = await env.container.payments.create(
        { loanId, amount: 1000, method: "CASH", idempotencyKey: randomUUID() },
        managerCtx()
      );
      await env.container.payments.reverse(payment.payment.id, "entered in error", managerCtx());

      // Invariant §74.12: history is added to, never rewritten.
      const events = await env.db.moneyEvent.findMany({ where: { loanId } });
      expect(events.filter((e) => e.type === "PAYMENT")).toHaveLength(1);
      expect(events.filter((e) => e.type === "PAYMENT_REVERSAL")).toHaveLength(1);
      const stored = await env.db.payment.findUniqueOrThrow({ where: { id: payment.payment.id } });
      expect(stored.status).toBe("REVERSED");
      expect(stored.amountCents).toBe(100_000);
    });

    it("survives two reversals issued at the same moment", async () => {
      const { loanId } = await originateLoan(env);
      const payment = await env.container.payments.create(
        { loanId, amount: 1000, method: "CASH", idempotencyKey: randomUUID() },
        managerCtx()
      );

      const results = await Promise.allSettled([
        env.container.payments.reverse(payment.payment.id, "a", managerCtx()),
        env.container.payments.reverse(payment.payment.id, "b", managerCtx()),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

      const reversals = await env.db.moneyEvent.findMany({
        where: { loanId, type: "PAYMENT_REVERSAL" },
      });
      expect(reversals).toHaveLength(1);
    });
  });

  describe("renewal", () => {
    it("does not lend the same balance forward twice on a retry", async () => {
      const { loanId } = await originateLoan(env);
      const key = randomUUID();
      const input = { reason: "客戶要求續借", idempotencyKey: key };

      const first = await env.container.renewals.renew(loanId, input, managerCtx());
      const second = await env.container.renewals.renew(loanId, input, managerCtx());

      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      expect(second.newLoan.id).toBe(first.newLoan.id);

      const renewals = await env.db.renewal.findMany({ where: { previousLoanId: loanId } });
      expect(renewals).toHaveLength(1);
    });

    it("carries the balance forward once when two renewals race under different keys", async () => {
      // Different keys defeat the idempotency column, so this is decided by
      // the conditional close of the previous loan. Both renewals underwrite
      // against the same servicing status; only one may act on it.
      const { loanId } = await originateLoan(env);
      const results = await Promise.allSettled([
        env.container.renewals.renew(
          loanId,
          { reason: "同時送出 A", idempotencyKey: randomUUID() },
          managerCtx()
        ),
        env.container.renewals.renew(
          loanId,
          { reason: "同時送出 B", idempotencyKey: randomUUID() },
          managerCtx()
        ),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

      const renewals = await env.db.renewal.findMany({ where: { previousLoanId: loanId } });
      expect(renewals).toHaveLength(1);

      // And the old loan is closed exactly once, with nothing left on it.
      const previous = await env.db.loan.findUniqueOrThrow({ where: { id: loanId } });
      expect(previous.status).toBe("RESTRUCTURED");
      expect(previous.outstandingPrincipalCents).toBe(0);
    });

    it("refuses a second renewal of a loan the first one already closed", async () => {
      const { loanId } = await originateLoan(env);
      await env.container.renewals.renew(
        loanId,
        { reason: "第一次續借", idempotencyKey: randomUUID() },
        managerCtx()
      );
      // The previous loan is no longer servicing, so a fresh key does not help.
      await expect(
        env.container.renewals.renew(
          loanId,
          { reason: "第二次續借", idempotencyKey: randomUUID() },
          managerCtx()
        )
      ).rejects.toThrow();
    });
  });

  describe("extension", () => {
    it("charges the fee and moves maturity only once on a retry", async () => {
      const { loanId } = await originateLoan(env);
      const key = randomUUID();
      const input = { extensionMonths: 1, fee: 500, reason: "短期週轉", idempotencyKey: key };

      const first = await env.container.renewals.extend(loanId, input, managerCtx());
      const second = await env.container.renewals.extend(loanId, input, managerCtx());

      expect(second.replayed).toBe(true);
      expect(second.extension.id).toBe(first.extension.id);

      const extensions = await env.db.extension.findMany({ where: { loanId } });
      expect(extensions).toHaveLength(1);
      expect(first.loan.maturityDate?.getTime()).toBe(second.loan.maturityDate?.getTime());
    });
  });

  describe("the Idempotency-Key payload guard", () => {
    it("fingerprints the same body identically regardless of key order", () => {
      const a = IdempotencyGuard.fingerprint("POST", "/payments", { amount: 10, loanId: "x" });
      const b = IdempotencyGuard.fingerprint("POST", "/payments", { loanId: "x", amount: 10 });
      expect(a).toBe(b);
    });

    it("fingerprints a different amount differently", () => {
      const a = IdempotencyGuard.fingerprint("POST", "/payments", { amount: 10 });
      const b = IdempotencyGuard.fingerprint("POST", "/payments", { amount: 1000 });
      expect(a).not.toBe(b);
    });

    it("rejects a key reused for a different request instead of replaying it", async () => {
      const { loanId } = await originateLoan(env);
      const jwt = await token("MANAGER");
      const key = randomUUID();

      await request(env.app)
        .post("/api/payments")
        .set("Authorization", `Bearer ${jwt}`)
        .set("Idempotency-Key", key)
        .send({ loanId, amount: 500, method: "CASH" })
        .expect(201);

      // Same key, ten times the money. Replaying here would tell the caller
      // 5,000 was taken when 500 was.
      const reused = await request(env.app)
        .post("/api/payments")
        .set("Authorization", `Bearer ${jwt}`)
        .set("Idempotency-Key", key)
        .send({ loanId, amount: 5000, method: "CASH" })
        .expect(409);
      expect(reused.body.code).toBe("IDEMPOTENCY_KEY_REUSED");

      const payments = await env.db.payment.findMany({ where: { loanId } });
      expect(payments).toHaveLength(1);
      expect(payments[0]!.amountCents).toBe(50_000);
    });

    it("still replays an identical request through the service", async () => {
      const { loanId } = await originateLoan(env);
      const jwt = await token("MANAGER");
      const key = randomUUID();
      const body = { loanId, amount: 500, method: "CASH" };

      await request(env.app)
        .post("/api/payments")
        .set("Authorization", `Bearer ${jwt}`)
        .set("Idempotency-Key", key)
        .send(body)
        .expect(201);

      const replay = await request(env.app)
        .post("/api/payments")
        .set("Authorization", `Bearer ${jwt}`)
        .set("Idempotency-Key", key)
        .send(body)
        .expect(200);
      expect(replay.body.replayed).toBe(true);

      const payments = await env.db.payment.findMany({ where: { loanId } });
      expect(payments).toHaveLength(1);
    });
  });
});
