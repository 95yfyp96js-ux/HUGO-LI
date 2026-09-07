import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createTestEnv, ctx, TEST_PASSWORD } from "../helpers/testEnv.js";
import { originateLoan } from "../helpers/originate.js";

/**
 * P4: rate limiting on authentication and money-moving writes.
 *
 * The limiter takes the injected Clock, so window expiry is proved by moving
 * time rather than by sleeping.
 */
describe("Rate limiting", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeEach(async () => {
    env = await createTestEnv(new Date("2026-01-01T09:00:00Z"), {
      rateLimits: {
        auth: { limit: 3, windowMs: 15 * 60 * 1000 },
        financial: { limit: 3, windowMs: 60 * 1000 },
        admin: { limit: 2, windowMs: 60 * 1000 },
      },
    });
  });

  afterEach(async () => {
    await env.cleanup();
  });

  const login = (email = "manager@test.local", password = TEST_PASSWORD) =>
    request(env.app).post("/api/auth/login").send({ email, password });

  async function token(role = "MANAGER") {
    const response = await login(`${role.toLowerCase()}@test.local`);
    return response.body.token as string;
  }

  describe("authentication", () => {
    it("allows attempts up to the limit", async () => {
      for (let i = 0; i < 3; i++) {
        await login().expect(200);
      }
    });

    it("returns 429 beyond the limit", async () => {
      for (let i = 0; i < 3; i++) await login();
      const response = await login().expect(429);
      expect(response.body.code).toBe("RATE_LIMITED");
      expect(response.body.details.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("counts failed attempts, which is the point of limiting login", async () => {
      for (let i = 0; i < 3; i++) await login("manager@test.local", "wrong").expect(401);
      await login().expect(429);
    });

    it("never reveals whether the account exists", async () => {
      for (let i = 0; i < 3; i++) await login("nobody@test.local", "wrong");
      const unknown = await login("nobody@test.local", "wrong").expect(429);
      const known = await login("manager@test.local", "wrong").expect(429);

      expect(unknown.body).toEqual(known.body);
      expect(JSON.stringify(unknown.body)).not.toContain("nobody@test.local");
      expect(JSON.stringify(unknown.body)).not.toContain("manager@test.local");
    });

    it("allows attempts again once the window passes", async () => {
      for (let i = 0; i < 3; i++) await login();
      await login().expect(429);

      env.clock.set(new Date("2026-01-01T09:16:00Z"));
      await login().expect(200);
    });
  });

  describe("financial writes", () => {
    it("limits payments per acting user and recovers after the window", async () => {
      const managerToken = await token("MANAGER");
      const { loanId } = await originateLoan(env);

      const pay = (key: string) =>
        request(env.app)
          .post("/api/payments")
          .set("Authorization", `Bearer ${managerToken}`)
          .set("Idempotency-Key", key)
          .send({ loanId, amount: 100 });

      for (let i = 0; i < 3; i++) await pay(`pay-${i}`).expect(201);
      const limited = await pay("pay-overflow").expect(429);
      expect(limited.body.code).toBe("RATE_LIMITED");

      // The refused payment must not have been recorded.
      expect(await env.db.payment.count({ where: { loanId } })).toBe(3);

      env.clock.set(new Date("2026-01-01T09:02:00Z"));
      await pay("pay-after-window").expect(201);
    });

    it("isolates one user's budget from another's", async () => {
      const managerToken = await token("MANAGER");
      const officerToken = await token("LOAN_OFFICER");
      const { loanId } = await originateLoan(env);

      for (let i = 0; i < 3; i++) {
        await request(env.app)
          .post("/api/payments")
          .set("Authorization", `Bearer ${managerToken}`)
          .set("Idempotency-Key", `mgr-${i}`)
          .send({ loanId, amount: 100 })
          .expect(201);
      }
      await request(env.app)
        .post("/api/payments")
        .set("Authorization", `Bearer ${managerToken}`)
        .set("Idempotency-Key", "mgr-overflow")
        .send({ loanId, amount: 100 })
        .expect(429);

      // A different user is unaffected.
      await request(env.app)
        .post("/api/payments")
        .set("Authorization", `Bearer ${officerToken}`)
        .set("Idempotency-Key", "officer-1")
        .send({ loanId, amount: 100 })
        .expect(201);
    });
  });

  describe("administrative writes", () => {
    it("limits product changes", async () => {
      const adminToken = await token("ADMIN");
      let productId = env.users.productId;

      for (let i = 0; i < 2; i++) {
        const response = await request(env.app)
          .patch(`/api/products/${productId}`)
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ ratePercent: 3 + i })
          .expect(200);
        productId = response.body.id;
      }

      await request(env.app)
        .patch(`/api/products/${productId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ ratePercent: 9 })
        .expect(429);
    });
  });

  describe("reads", () => {
    it("does not limit ordinary reads", async () => {
      const managerToken = await token("MANAGER");
      // Comfortably beyond every write limit configured above.
      for (let i = 0; i < 25; i++) {
        await request(env.app)
          .get("/api/loans")
          .set("Authorization", `Bearer ${managerToken}`)
          .expect(200);
      }
      await request(env.app)
        .get("/api/dashboard")
        .set("Authorization", `Bearer ${managerToken}`)
        .expect(200);
    });
  });
});
