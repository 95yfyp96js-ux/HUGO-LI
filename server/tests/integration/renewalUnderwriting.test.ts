import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestEnv, ctx } from "../helpers/testEnv.js";
import { originateLoan } from "../helpers/originate.js";
import { Money } from "../../src/shared/money.js";
import { randomUUID } from "node:crypto";

/**
 * P2: a renewal is a new credit decision, not a copy of the old one.
 *
 * The chain must be Renewal -> new Application -> new Risk -> new Limit ->
 * new Pricing -> new Approval -> new Loan, recomputed from the customer's
 * position today. These tests assert the new chain exists AND that the old
 * one is untouched.
 */
describe("Renewal re-underwriting", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeEach(async () => {
    env = await createTestEnv(new Date("2026-01-01T09:00:00Z"));
  });

  afterEach(async () => {
    await env.cleanup();
  });

  const manager = () => ctx(env.users.userIds.MANAGER!);

  it("builds every node of the new lending chain", async () => {
    const { loanId, applicationId } = await originateLoan(env);

    const { newLoan } = await env.container.renewals.renew(
      loanId,
      { idempotencyKey: randomUUID(), reason: "客戶申請續借" },
      manager()
    );

    const renewedLoan = await env.db.loan.findUniqueOrThrow({
      where: { id: newLoan.id },
      include: {
        snapshot: true,
        application: {
          include: {
            riskAssessments: { include: { factors: true } },
            lendingLimits: true,
            loanOffers: true,
            approvals: true,
          },
        },
      },
    });

    const application = renewedLoan.application;

    // A new application, not the original one.
    expect(application.id).not.toBe(applicationId);
    expect(application.status).toBe("APPROVED");

    // Each underwriting node exists on the new application.
    expect(application.riskAssessments).toHaveLength(1);
    expect(application.lendingLimits).toHaveLength(1);
    expect(application.loanOffers).toHaveLength(1);
    expect(application.approvals).toHaveLength(1);

    const assessment = application.riskAssessments[0]!;
    expect(assessment.grade).toBeTruthy();
    expect(["A", "B", "C", "D", "E"]).toContain(assessment.grade);
    expect(assessment.score).toBeGreaterThanOrEqual(0);
    expect(assessment.factors.length).toBeGreaterThan(0);

    // The approval is tied to the new offer, and the snapshot records the new
    // decision rather than the previous loan's.
    const approval = application.approvals[0]!;
    const offer = application.loanOffers[0]!;
    expect(approval.loanOfferId).toBe(offer.id);
    expect(renewedLoan.snapshot!.approvalVersion).toBe(approval.id);
    expect(renewedLoan.snapshot!.ratePercent).toBe(offer.ratePercent);
    expect(renewedLoan.snapshot!.riskAssessmentVersion).toBe(assessment.modelVersion);
  });

  it("leaves the original application, assessment and loan history untouched", async () => {
    const { loanId, applicationId } = await originateLoan(env);

    const originalApplicationBefore = await env.db.lendingApplication.findUniqueOrThrow({
      where: { id: applicationId },
      include: { riskAssessments: true, loanOffers: true, approvals: true },
    });
    const originalEventsBefore = await env.db.moneyEvent.findMany({ where: { loanId } });

    await env.container.renewals.renew(loanId, { idempotencyKey: randomUUID(), reason: "續借" }, manager());

    const originalApplicationAfter = await env.db.lendingApplication.findUniqueOrThrow({
      where: { id: applicationId },
      include: { riskAssessments: true, loanOffers: true, approvals: true },
    });

    expect(originalApplicationAfter.status).toBe(originalApplicationBefore.status);
    expect(originalApplicationAfter.riskAssessments.map((a) => a.id)).toEqual(
      originalApplicationBefore.riskAssessments.map((a) => a.id)
    );
    expect(originalApplicationAfter.riskAssessments[0]!.grade).toBe(
      originalApplicationBefore.riskAssessments[0]!.grade
    );
    expect(originalApplicationAfter.loanOffers).toHaveLength(originalApplicationBefore.loanOffers.length);
    expect(originalApplicationAfter.approvals).toHaveLength(originalApplicationBefore.approvals.length);

    // The old loan's ledger only gains the settlement that discharges it.
    const originalEventsAfter = await env.db.moneyEvent.findMany({ where: { loanId } });
    expect(originalEventsAfter.length).toBe(originalEventsBefore.length + 1);
    const byId = new Map(originalEventsAfter.map((e) => [e.id, e]));
    for (const before of originalEventsBefore) {
      expect(byId.get(before.id)?.amountCents).toBe(before.amountCents);
      expect(byId.get(before.id)?.type).toBe(before.type);
    }
  });

  it("recomputes risk from today's position rather than copying the old grade", async () => {
    // A customer who has since fallen behind must not inherit their
    // origination-day assessment.
    const { loanId, assessment: originalAssessment } = await originateLoan(env);

    const originalOverdueFactor = await env.db.riskFactor.findFirstOrThrow({
      where: { riskAssessmentId: originalAssessment.id, code: "CURRENTLY_OVERDUE" },
    });
    expect(originalOverdueFactor.points).toBe(0);

    // Let the loan fall badly overdue, then renew.
    env.clock.set(new Date("2026-04-15T09:00:00Z"));
    await env.container.loans.refreshDelinquency(loanId, manager());
    const overdue = await env.db.loan.findUniqueOrThrow({ where: { id: loanId } });
    expect(overdue.status).toBe("OVERDUE");

    const { newLoan } = await env.container.renewals.renew(loanId, { idempotencyKey: randomUUID(), reason: "逾期後續借" }, manager());

    const renewalAssessment = await env.db.riskAssessment.findFirstOrThrow({
      where: { application: { loan: { id: newLoan.id } } },
      include: { factors: true },
      orderBy: { createdAt: "desc" },
    });

    // A different assessment, genuinely re-scored on the delinquency.
    expect(renewalAssessment.id).not.toBe(originalAssessment.id);
    const newOverdueFactor = renewalAssessment.factors.find((f) => f.code === "CURRENTLY_OVERDUE")!;
    expect(newOverdueFactor.points).toBeGreaterThan(0);
    expect(renewalAssessment.score).toBeLessThan(originalAssessment.score);

    // And the deterioration is reflected in what the customer now pays.
    const snapshot = await env.db.loanSnapshot.findUniqueOrThrow({ where: { loanId: newLoan.id } });
    const previousSnapshot = await env.db.loanSnapshot.findUniqueOrThrow({ where: { loanId } });
    expect(snapshot.ratePercent).toBeGreaterThanOrEqual(previousSnapshot.ratePercent);
  });

  it("keeps a well-performing customer on good terms", async () => {
    const { loanId } = await originateLoan(env, { monthlyIncome: 200000, amount: 30000 });

    // Pay the first installment on time, then renew while still current.
    env.clock.set(new Date("2026-02-01T09:00:00Z"));
    await env.container.payments.create(
      { loanId, amount: 750, idempotencyKey: "good-payer-1" },
      manager()
    );

    const { newLoan } = await env.container.renewals.renew(loanId, { idempotencyKey: randomUUID(), reason: "客戶要求續借" }, manager());

    const assessment = await env.db.riskAssessment.findFirstOrThrow({
      where: { application: { loan: { id: newLoan.id } } },
      orderBy: { createdAt: "desc" },
    });
    expect(["A", "B"]).toContain(assessment.grade);
    expect(assessment.decision).toBe("AUTO_APPROVE");
  });

  it("refuses an additional advance that exceeds the customer's limit", async () => {
    const { loanId } = await originateLoan(env, { monthlyIncome: 20000, amount: 20000 });

    await expect(
      env.container.renewals.renew(
        loanId,
        { idempotencyKey: randomUUID(), reason: "要求大額增貸", additionalAmount: 5_000_000 },
        manager()
      )
    ).rejects.toMatchObject({ code: "RENEWAL_NOT_PERMITTED" });
  });

  it("still allows a pure rollover, which is not new lending", async () => {
    // Deliberately a weak customer: rolling the existing balance forward must
    // not be blocked, because refusing does not make the debt disappear.
    const { loanId } = await originateLoan(env, { monthlyIncome: 20000, amount: 30000 });
    env.clock.set(new Date("2026-05-01T09:00:00Z"));
    await env.container.loans.refreshDelinquency(loanId, manager());

    const { newLoan } = await env.container.renewals.renew(loanId, { idempotencyKey: randomUUID(), reason: "純展延" }, manager());
    expect(newLoan.status).toBe("ACTIVE");
  });

  it("does not exclude the renewed loan's own balance from its own limit", async () => {
    // Regression: counting the loan being replaced as existing exposure would
    // make every rollover look over-limit.
    const { loanId } = await originateLoan(env, { monthlyIncome: 100000, amount: 50000 });

    const { newLoan } = await env.container.renewals.renew(loanId, { idempotencyKey: randomUUID(), reason: "續借" }, manager());

    const limit = await env.db.lendingLimit.findFirstOrThrow({
      where: { application: { loan: { id: newLoan.id } } },
      orderBy: { createdAt: "desc" },
    });
    // The only live loan was the one being replaced, so exposure is zero.
    expect(limit.currentExposureCents).toBe(0);
    expect(limit.availableLimitCents).toBeGreaterThan(0);
  });

  it("records the underwriting outcome in the audit trail", async () => {
    const { loanId } = await originateLoan(env);
    const { renewal } = await env.container.renewals.renew(loanId, { idempotencyKey: randomUUID(), reason: "續借" }, manager());

    const entry = await env.db.auditLog.findFirstOrThrow({
      where: { action: "RENEWAL_CREATED", resourceId: renewal.id },
    });
    const after = JSON.parse(entry.after!) as Record<string, unknown>;
    const metadata = JSON.parse(entry.metadata) as Record<string, unknown>;

    expect(after.riskGrade).toBeTruthy();
    expect(after.newRatePercent).toBeDefined();
    expect(metadata.riskAssessmentId).toBeTruthy();
    expect(metadata.lendingLimitId).toBeTruthy();
    expect(metadata.loanOfferId).toBeTruthy();
    expect(metadata.renewalApplicationId).toBeTruthy();

    // The whole chain is auditable.
    const actions = (
      await env.db.auditLog.findMany({ orderBy: { timestamp: "asc" } })
    ).map((a) => a.action);
    for (const expected of [
      "RISK_ASSESSMENT_CREATED",
      "LENDING_LIMIT_CALCULATED",
      "LOAN_OFFER_CREATED",
      "RENEWAL_CREATED",
    ]) {
      expect(actions).toContain(expected);
    }
  });

  it("makes renewed loans appear with a risk grade in the portfolio breakdown", async () => {
    const { loanId } = await originateLoan(env);
    await env.container.renewals.renew(loanId, { idempotencyKey: randomUUID(), reason: "續借" }, manager());

    const breakdown = await env.container.portfolio.byRiskGrade();
    const ungraded = breakdown.find((b) => b.grade === "UNGRADED");

    // The renewed loan is live and must carry a grade of its own.
    expect(ungraded?.loanCount ?? 0).toBe(0);
    expect(breakdown.reduce((sum, b) => sum + b.loanCount, 0)).toBe(1);
  });

  it("carries the full balance forward and settles the old loan", async () => {
    const { loanId } = await originateLoan(env, { amount: 50000 });
    const before = await env.db.loan.findUniqueOrThrow({ where: { id: loanId } });
    const carried = Money.fromMinorUnits(
      before.outstandingPrincipalCents + before.outstandingInterestCents + before.outstandingFeeCents
    );

    const { newLoan } = await env.container.renewals.renew(loanId, { idempotencyKey: randomUUID(), reason: "續借" }, manager());

    expect(Money.fromMinorUnits(newLoan.principalCents).equals(carried)).toBe(true);
    const closed = await env.db.loan.findUniqueOrThrow({ where: { id: loanId } });
    expect(closed.status).toBe("RESTRUCTURED");
    expect(closed.outstandingPrincipalCents).toBe(0);
  });
});
