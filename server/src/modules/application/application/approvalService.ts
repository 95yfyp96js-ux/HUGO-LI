import type { PrismaClient } from "@prisma/client";
import { Money } from "../../../shared/money.js";
import { ApplicationNotFoundError, ValidationError } from "../../../shared/errors.js";
import type { AuditContext, AuditService } from "../../audit/application/auditService.js";
import { ApplicationStateMachine, type ApplicationStatus } from "../domain/applicationStateMachine.js";

export interface ApprovalCondition {
  code: string;
  description: string;
}

export interface ApproveInput {
  approvedAmount?: string | number;
  approvedTermCount?: number;
  approvedRatePercent?: number;
  conditions?: ApprovalCondition[];
  reason?: string | null;
}

/**
 * ApprovalService is the only path from an under-review application to an
 * APPROVED one. It records WHO decided, WHAT they approved and WHY —
 * approving is never a bare status flip.
 */
export class ApprovalService {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditService
  ) {}

  async approve(applicationId: string, input: ApproveInput, context: AuditContext) {
    const application = await this.db.lendingApplication.findUnique({
      where: { id: applicationId },
      include: { loanOffers: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!application) throw new ApplicationNotFoundError(applicationId);

    ApplicationStateMachine.assertTransition(application.status as ApplicationStatus, "APPROVED");

    const offer = application.loanOffers[0];
    if (!offer) {
      throw new ValidationError("Cannot approve an application that has no priced offer", {
        applicationId,
      });
    }

    const approvedAmount =
      input.approvedAmount !== undefined
        ? Money.fromMajorUnits(input.approvedAmount)
        : Money.fromMinorUnits(offer.approvedAmountCents);
    const approvedTermCount = input.approvedTermCount ?? offer.termCount;
    const approvedRatePercent = input.approvedRatePercent ?? offer.ratePercent;

    if (!approvedAmount.isPositive()) {
      throw new ValidationError("approvedAmount must be positive");
    }

    const conditions = input.conditions ?? [];
    const decision = conditions.length > 0 ? "CONDITIONAL" : "APPROVED";

    const [approval, updatedApplication] = await this.db.$transaction([
      this.db.loanApproval.create({
        data: {
          applicationId,
          loanOfferId: offer.id,
          decision,
          approvedAmountCents: approvedAmount.toMinorUnits(),
          approvedTermCount,
          approvedRatePercent,
          conditions: JSON.stringify(conditions),
          reason: input.reason ?? null,
          approvedBy: context.userId,
          approvedAt: new Date(),
        },
      }),
      this.db.lendingApplication.update({
        where: { id: applicationId },
        data: { status: "APPROVED" },
      }),
    ]);

    await this.audit.record(context, {
      action: "APPLICATION_APPROVED",
      resource: "LendingApplication",
      resourceId: applicationId,
      before: { status: application.status },
      after: {
        status: "APPROVED",
        decision,
        approvedAmount: approvedAmount.toMajorUnitsString(),
        approvedTermCount,
        approvedRatePercent,
      },
      reason: input.reason ?? null,
    });

    return { approval, application: updatedApplication };
  }

  async reject(applicationId: string, reason: string, context: AuditContext) {
    const application = await this.db.lendingApplication.findUnique({ where: { id: applicationId } });
    if (!application) throw new ApplicationNotFoundError(applicationId);
    if (!reason?.trim()) throw new ValidationError("A rejection reason is required");

    ApplicationStateMachine.assertTransition(application.status as ApplicationStatus, "REJECTED");

    const [approval, updatedApplication] = await this.db.$transaction([
      this.db.loanApproval.create({
        data: {
          applicationId,
          decision: "REJECTED",
          conditions: "[]",
          reason,
          approvedBy: context.userId,
          approvedAt: new Date(),
        },
      }),
      this.db.lendingApplication.update({
        where: { id: applicationId },
        data: { status: "REJECTED" },
      }),
    ]);

    await this.audit.record(context, {
      action: "APPLICATION_REJECTED",
      resource: "LendingApplication",
      resourceId: applicationId,
      before: { status: application.status },
      after: { status: "REJECTED" },
      reason,
    });

    return { approval, application: updatedApplication };
  }
}
