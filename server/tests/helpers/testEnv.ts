import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { createApp, type AppOptions } from "../../src/app.js";
import { MockClock } from "../../src/shared/clock.js";
import { hashPassword } from "../../src/modules/auth/infrastructure/password.js";
import { ROLE_PERMISSIONS, PERMISSIONS, type RoleCode } from "../../src/modules/auth/domain/permissions.js";
import { Money } from "../../src/shared/money.js";

export const TEST_PASSWORD = "TestPassword123!";

/**
 * Each test file gets its own throwaway SQLite database and a MockClock, so
 * tests are isolated and can drive time forward deterministically.
 */
export async function createTestEnv(
  startDate = new Date("2026-01-01T09:00:00Z"),
  options: {
    rateLimits?: AppOptions["rateLimits"];
    disbursementProvider?: AppOptions["disbursementProvider"];
  } = {}
) {
  const dir = mkdtempSync(join(tmpdir(), "lending-test-"));
  const dbPath = join(dir, "test.db");
  const databaseUrl = `file:${dbPath}`;

  execSync("npx prisma migrate deploy", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });

  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const clock = new MockClock(startDate);
  const { app, container } = createApp({
    db,
    clock,
    jwtSecret: "test-secret",
    disbursementProvider: options.disbursementProvider,
    // Generous by default so unrelated tests are never throttled; the
    // rate-limit tests pass tight values of their own.
    rateLimits: options.rateLimits ?? {
      auth: { limit: 10_000, windowMs: 60_000 },
      financial: { limit: 10_000, windowMs: 60_000 },
      admin: { limit: 10_000, windowMs: 60_000 },
    },
  });

  const users = await seedUsersAndProducts(db);

  return {
    app,
    container,
    db,
    clock,
    users,
    async cleanup() {
      await db.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function seedUsersAndProducts(db: PrismaClient) {
  for (const code of PERMISSIONS) {
    await db.permission.create({ data: { code } });
  }

  for (const [code, permissions] of Object.entries(ROLE_PERMISSIONS) as [RoleCode, string[]][]) {
    const role = await db.role.create({ data: { code, name: code } });
    for (const permissionCode of permissions) {
      const permission = await db.permission.findUniqueOrThrow({ where: { code: permissionCode } });
      await db.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
  }

  const passwordHash = hashPassword(TEST_PASSWORD);
  const userIds: Record<string, string> = {};
  for (const roleCode of Object.keys(ROLE_PERMISSIONS) as RoleCode[]) {
    const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
    const user = await db.user.create({
      data: {
        email: `${roleCode.toLowerCase()}@test.local`,
        displayName: roleCode,
        passwordHash,
        roles: { create: { roleId: role.id } },
      },
    });
    userIds[roleCode] = user.id;
  }

  const product = await db.loanProduct.create({
    data: {
      productCode: "TEST-STD",
      name: "Test standard product",
      minAmountCents: Money.fromMajorUnits(1000).toMinorUnits(),
      maxAmountCents: Money.fromMajorUnits(1000000).toMinorUnits(),
      minTermCount: 1,
      maxTermCount: 24,
      ratePercent: 2.5,
      rateUnit: "MONTHLY",
      calculationMethod: "SIMPLE_INTEREST",
      repaymentMethod: "INTEREST_ONLY",
      feeRules: "[]",
    },
  });

  return { userIds, productId: product.id };
}

export function ctx(userId: string) {
  return { userId, ip: "127.0.0.1" };
}
