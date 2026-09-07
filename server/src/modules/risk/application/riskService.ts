import type { PrismaClient } from "@prisma/client";
import { Money } from "../../../shared/money.js";
import { ApplicationNotFoundError } from "../../../shared/errors.js";
import type { AuditContext, AuditService } from "../../audit/application/auditService.js";
import { RiskEngine, type RiskGrade } from "../domain/riskEngine.js";
import { LendingLimitEngine } from "../domain/lendingLimitEngine.js";
import type { Clock } from "../../../shared/clock.js";
import { OverdueEngine } from "../../loan/domain/overdueEngine.js";

const SERVICING = ["ACTIVE", "DUE_SOON", "DUE", "OVERDUE", "DEFAULTED"];

/**
 * RiskService gathers the customer's real history from the database and hands
 * it to the pure RiskEngine / LendingLimitEngine, then persists the result.
 * No scoring logic lives here.
 */
export class RiskService {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditService,
    private readonly clock: Clock
  ) {}

  async assessApplication(applicationId: string, context: AuditContext) {
    const application = await this.db.lendingApplication.findUnique({
      where: { id: applicationId },
      include: { customer: true },
    });
    if (!application) throw new ApplicationNotFoundError(applicationId);

    const input = await this.buildRiskInput(application);
    const result = RiskEngine.assess(input);

    const assessment = await this.db.riskAssessment.create({
      data: {
        customerId: application.customerId,
        applicationId: application.id,
        score: result.score,
        grade: result.grade,
        decision: result.decision,
        reasons: JSON.stringify(result.reasons),
        modelVersion: result.modelVersion,
        factors: {
          create: result.factors.map((f) => ({
            code: f.code,
            label: f.label,
            value: f.value,
            points: f.points,
          })),
        },
      },
      include: { factors: true },
    });

    await this.audit.record(context, {
      action: "RISK_ASSESSMENT_CREATED",
      resource: "RiskAssessment",
      resourceId: assessment.id,
      after: { score: result.score, grade: result.grade, decision: result.decision },
      metadata: { applicationId, modelVersion: result.modelVersion },
    });

    return assessment;
  }

  async calculateLimit(applicationId: string, riskAssessmentId: string, context: AuditContext) {
    const application = await this.db.lendingApplication.findUnique({
      where: { id: applicationId },
      include: { customer: true, requestedProduct: true },
    });
    if (!application) throw new ApplicationNotFoundError(applicationId);

    const assessment = await this.db.riskAssessment.findUniqueOrThrow({
      where: { id: riskAssessmentId },
    });

    const exposure = await this.currentExposure(application.customerId);

    const result = LendingLimitEngine.calculate({
      monthlyIncome: resolveIncome(application.incomeCents, application.customer.monthlyIncomeCents),
      riskGrade: assessment.grade as RiskGrade,
      currentExposure: exposure,
      requestedAmount: Money.fromMinorUnits(application.requestedAmountCents),
      productMaxAmount: Money.fromMinorUnits(application.requestedProduct.maxAmountCents),
      productMinAmount: Money.fromMinorUnits(application.requestedProduct.minAmountCents),
    });

    const limit = await this.db.lendingLimit.create({
      data: {
        customerId: application.customerId,
        applicationId: application.id,
        maximumLimitCents: result.maximumLimit.toMinorUnits(),
        currentExposureCents: result.currentExposure.toMinorUnits(),
        availableLimitCents: result.availableLimit.toMinorUnits(),
        requestedAmountCents: result.requestedAmount.toMinorUnits(),
        recommendedAmountCents: result.recommendedAmount.toMinorUnits(),
        decision: result.decision,
        reasons: JSON.stringify(result.reasons),
        engineVersion: result.engineVersion,
      },
    });

    await this.audit.record(context, {
      action: "LENDING_LIMIT_CALCULATED",
      resource: "LendingLimit",
      resourceId: limit.id,
      after: {
        maximumLimit: result.maximumLimit.toMajorUnitsString(),
        availableLimit: result.availableLimit.toMajorUnitsString(),
        recommendedAmount: result.recommendedAmount.toMajorUnitsString(),
        decision: result.decision,
      },
      metadata: { applicationId },
    });

    return limit;
  }

  /** Total the customer currently owes us across all live loans. */
  async currentExposure(customerId: string): Promise<Money> {
    const loans = await this.db.loan.findMany({
      where: { customerId, status: { in: SERVICING } },
      select: {
        outstandingPrincipalCents: true,
        outstandingInterestCents: true,
        outstandingFeeCents: true,
      },
    });
    return Money.sum(
      loans.map((l) =>
        Money.fromMinorUnits(
          l.outstandingPrincipalCents + l.outstandingInterestCents + l.outstandingFeeCents
        )
      )
    );
  }

  private async buildRiskInput(application: {
    id: string;
    customerId: string;
    requestedAmountCents: number;
    requestedTermMonths: number;
    incomeCents: number | null;
    existingDebtCents: number | null;
    customer: { status: string; monthlyIncomeCents: number | null };
  }) {
    const loans = await this.db.loan.findMany({
      where: { customerId: application.customerId },
      include: { scheduleLines: true },
    });

    const now = this.clock.now();
    let latePaymentCount = 0;
    let totalDaysLate = 0;
    let lateLoanCount = 0;
    let currentlyOverdueLoanCount = 0;

    for (const loan of loans) {
      const evaluation = OverdueEngine.evaluate({
        currentDate: now,
        scheduleLines: loan.scheduleLines.map((line) => ({
          installmentNumber: line.installmentNumber,
          dueDate: line.dueDate,
          totalDue: Money.fromMinorUnits(line.totalDueCents),
          totalPaid: Money.fromMinorUnits(
            line.principalPaidCents + line.interestPaidCents + line.feePaidCents
          ),
        })),
      });

      if (evaluation.daysOverdue > 0) {
        latePaymentCount += evaluation.overdueInstallments.length;
        totalDaysLate += evaluation.daysOverdue;
        lateLoanCount += 1;
        if (SERVICING.includes(loan.status)) currentlyOverdueLoanCount += 1;
      }
    }

    const exposure = await this.currentExposure(application.customerId);

    return {
      requestedAmount: Money.fromMinorUnits(application.requestedAmountCents),
      requestedTermMonths: application.requestedTermMonths,
      monthlyIncome: resolveIncome(application.incomeCents, application.customer.monthlyIncomeCents),
      existingDebt: Money.fromMinorUnits(application.existingDebtCents ?? 0),
      currentExposure: exposure,
      historicalLoanCount: loans.length,
      paidOffLoanCount: loans.filter((l) => l.status === "PAID_OFF").length,
      latePaymentCount,
      averageDaysLate: lateLoanCount === 0 ? 0 : Math.round(totalDaysLate / lateLoanCount),
      currentlyOverdueLoanCount,
      customerStatus: application.customer.status,
    };
  }
}

/** The income stated on the application wins; the customer record is the fallback. */
function resolveIncome(applicationIncome: number | null, customerIncome: number | null): Money | null {
  const cents = applicationIncome ?? customerIncome;
  return cents == null ? null : Money.fromMinorUnits(cents);
}
