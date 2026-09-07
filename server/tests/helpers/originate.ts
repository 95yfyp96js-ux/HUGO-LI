import type { createTestEnv } from "./testEnv.js";
import { ctx } from "./testEnv.js";

type Env = Awaited<ReturnType<typeof createTestEnv>>;

let identitySequence = 0;

/**
 * Drives an application all the way to a live, disbursed loan through the
 * real services — the same path the UI takes. Shared so tests exercise
 * origination identically rather than each inventing its own shortcut.
 */
export async function originateLoan(
  env: Env,
  options: {
    amount?: number;
    termMonths?: number;
    monthlyIncome?: number;
    name?: string;
    identityNumber?: string;
    customerId?: string;
  } = {}
) {
  const customerId =
    options.customerId ??
    (
      await env.container.customers.create(
        {
          name: options.name ?? "測試客戶",
          identityNumber: options.identityNumber ?? `T${String(++identitySequence).padStart(9, "0")}`,
          dateOfBirth: "1990-01-01",
          phone: "0912345678",
          monthlyIncome: options.monthlyIncome ?? 80000,
        },
        ctx(env.users.userIds.LOAN_OFFICER!)
      )
    ).id;

  const application = await env.container.applications.create(
    {
      customerId,
      requestedProductId: env.users.productId,
      requestedAmount: options.amount ?? 50000,
      requestedTermMonths: options.termMonths ?? 3,
      income: options.monthlyIncome ?? 80000,
      existingDebt: 0,
    },
    ctx(env.users.userIds.LOAN_OFFICER!)
  );

  const submitted = await env.container.applications.submit(
    application.id,
    ctx(env.users.userIds.LOAN_OFFICER!)
  );
  await env.container.approvals.approve(
    application.id,
    { reason: "ok" },
    ctx(env.users.userIds.MANAGER!)
  );
  const loan = await env.container.loans.createFromApprovedApplication(
    application.id,
    ctx(env.users.userIds.MANAGER!)
  );
  await env.container.loans.disburse(
    loan.id,
    { idempotencyKey: `disburse-${loan.id}` },
    ctx(env.users.userIds.MANAGER!)
  );

  return {
    customerId,
    applicationId: application.id,
    loanId: loan.id,
    assessment: submitted.assessment,
  };
}
