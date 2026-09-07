import type { Prisma, PrismaClient } from "@prisma/client";
import { Money } from "../../../shared/money.js";
import {
  ApplicationNotFoundError,
  CustomerNotFoundError,
  ProductNotFoundError,
  ValidationError,
} from "../../../shared/errors.js";
import { formatSequenceNumber } from "../../../shared/ids.js";
import type { AuditContext, AuditService } from "../../audit/application/auditService.js";
import { ApplicationStateMachine, type ApplicationStatus } from "../domain/applicationStateMachine.js";
import { RiskService } from "../../risk/application/riskService.js";
import { PricingService } from "../../pricing/application/pricingService.js";

export interface CreateApplicationInput {
  customerId: string;
  requestedProductId: string;
  requestedAmount: string | number;
  requestedTermMonths: number;
  purpose?: string | null;
  income?: string | number | null;
  existingDebt?: string | number | null;
}

export class LendingApplicationService {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditService,
    private readonly risk: RiskService,
    private readonly pricing: PricingService
  ) {}

  async create(input: CreateApplicationInput, context: AuditContext) {
    // Invariant §74.1: no customer, no application.
    const customer = await this.db.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw new CustomerNotFoundError(input.customerId);

    const product = await this.db.loanProduct.findUnique({ where: { id: input.requestedProductId } });
    if (!product) throw new ProductNotFoundError(input.requestedProductId);
    if (product.status !== "ACTIVE") {
      throw new ValidationError("Cannot apply against a product that is not ACTIVE", {
        productId: product.id,
        status: product.status,
      });
    }

    const requestedAmount = Money.fromMajorUnits(input.requestedAmount);
    if (!requestedAmount.isPositive()) {
      throw new ValidationError("requestedAmount must be positive");
    }
    if (input.requestedTermMonths <= 0) {
      throw new ValidationError("requestedTermMonths must be positive");
    }

    const sequence = (await this.db.lendingApplication.count()) + 1;
    const application = await this.db.lendingApplication.create({
      data: {
        applicationNumber: formatSequenceNumber("APP", sequence),
        customerId: customer.id,
        requestedProductId: product.id,
        requestedAmountCents: requestedAmount.toMinorUnits(),
        requestedTermMonths: input.requestedTermMonths,
        purpose: input.purpose ?? null,
        incomeCents: input.income != null ? Money.fromMajorUnits(input.income).toMinorUnits() : null,
        existingDebtCents:
          input.existingDebt != null ? Money.fromMajorUnits(input.existingDebt).toMinorUnits() : null,
        status: "DRAFT",
      },
    });

    await this.audit.record(context, {
      action: "APPLICATION_CREATED",
      resource: "LendingApplication",
      resourceId: application.id,
      after: application,
    });

    return application;
  }

  async update(id: string, input: Partial<CreateApplicationInput>, context: AuditContext) {
    const before = await this.requireApplication(id);
    if (before.status !== "DRAFT") {
      throw new ValidationError("Only a DRAFT application can be edited", { status: before.status });
    }

    const data: Prisma.LendingApplicationUpdateInput = {};
    if (input.requestedAmount !== undefined) {
      data.requestedAmountCents = Money.fromMajorUnits(input.requestedAmount).toMinorUnits();
    }
    if (input.requestedTermMonths !== undefined) data.requestedTermMonths = input.requestedTermMonths;
    if (input.purpose !== undefined) data.purpose = input.purpose;
    if (input.income !== undefined) {
      data.incomeCents = input.income != null ? Money.fromMajorUnits(input.income).toMinorUnits() : null;
    }
    if (input.existingDebt !== undefined) {
      data.existingDebtCents =
        input.existingDebt != null ? Money.fromMajorUnits(input.existingDebt).toMinorUnits() : null;
    }
    if (input.requestedProductId !== undefined) {
      data.requestedProduct = { connect: { id: input.requestedProductId } };
    }

    const after = await this.db.lendingApplication.update({ where: { id }, data });
    await this.audit.record(context, {
      action: "APPLICATION_CREATED",
      resource: "LendingApplication",
      resourceId: id,
      before,
      after,
    });
    return after;
  }

  /**
   * Submitting runs the underwriting pipeline: risk -> limit -> pricing.
   * The application lands in UNDER_REVIEW (or RISK_REVIEW when the risk
   * engine wants a human), never straight to APPROVED.
   */
  async submit(id: string, context: AuditContext) {
    const application = await this.requireApplication(id);
    this.transition(application.status as ApplicationStatus, "SUBMITTED");

    const assessment = await this.risk.assessApplication(application.id, context);
    const limit = await this.risk.calculateLimit(application.id, assessment.id, context);

    // Price an offer for whatever we are actually willing to lend.
    const offer =
      limit.recommendedAmountCents > 0
        ? await this.pricing.createOffer(
            {
              applicationId: application.id,
              approvedAmount: Money.fromMinorUnits(limit.recommendedAmountCents),
              termMonths: application.requestedTermMonths,
              riskGrade: assessment.grade as "A" | "B" | "C" | "D" | "E",
            },
            context
          )
        : null;

    const nextStatus: ApplicationStatus =
      assessment.decision === "AUTO_APPROVE" && offer ? "UNDER_REVIEW" : "RISK_REVIEW";

    ApplicationStateMachine.assertTransition("SUBMITTED", nextStatus);

    const updated = await this.db.lendingApplication.update({
      where: { id },
      data: { status: nextStatus },
    });

    await this.audit.record(context, {
      action: "APPLICATION_SUBMITTED",
      resource: "LendingApplication",
      resourceId: id,
      before: { status: application.status },
      after: { status: nextStatus },
      metadata: {
        riskGrade: assessment.grade,
        riskDecision: assessment.decision,
        limitDecision: limit.decision,
        offerId: offer?.id ?? null,
      },
    });

    return { application: updated, assessment, limit, offer };
  }

  async cancel(id: string, reason: string | null, context: AuditContext) {
    const application = await this.requireApplication(id);
    this.transition(application.status as ApplicationStatus, "CANCELLED");

    const updated = await this.db.lendingApplication.update({
      where: { id },
      data: { status: "CANCELLED" },
    });

    await this.audit.record(context, {
      action: "APPLICATION_REJECTED",
      resource: "LendingApplication",
      resourceId: id,
      before: { status: application.status },
      after: { status: "CANCELLED" },
      reason,
    });

    return updated;
  }

  async getById(id: string) {
    const application = await this.db.lendingApplication.findUnique({
      where: { id },
      include: {
        customer: true,
        requestedProduct: true,
        riskAssessments: { orderBy: { createdAt: "desc" }, include: { factors: true } },
        lendingLimits: { orderBy: { createdAt: "desc" } },
        loanOffers: { orderBy: { createdAt: "desc" }, include: { product: true } },
        approvals: { orderBy: { createdAt: "desc" } },
        loan: true,
      },
    });
    if (!application) throw new ApplicationNotFoundError(id);
    return application;
  }

  async list(params: { status?: string; customerId?: string; take?: number; skip?: number }) {
    const where: Prisma.LendingApplicationWhereInput = {};
    if (params.status) where.status = params.status;
    if (params.customerId) where.customerId = params.customerId;

    const [items, total] = await Promise.all([
      this.db.lendingApplication.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: params.take ?? 25,
        skip: params.skip ?? 0,
        include: {
          customer: { select: { id: true, name: true, customerNumber: true } },
          requestedProduct: { select: { id: true, name: true, productCode: true } },
          riskAssessments: { orderBy: { createdAt: "desc" }, take: 1 },
          loanOffers: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      }),
      this.db.lendingApplication.count({ where }),
    ]);

    return { items, total };
  }

  private transition(from: ApplicationStatus, to: ApplicationStatus): void {
    ApplicationStateMachine.assertTransition(from, to);
  }

  private async requireApplication(id: string) {
    const application = await this.db.lendingApplication.findUnique({ where: { id } });
    if (!application) throw new ApplicationNotFoundError(id);
    return application;
  }
}
