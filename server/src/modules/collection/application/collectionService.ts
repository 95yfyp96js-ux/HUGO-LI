import type { Prisma, PrismaClient } from "@prisma/client";
import { Money } from "../../../shared/money.js";
import { CollectionCaseNotFoundError, LoanNotFoundError, ValidationError } from "../../../shared/errors.js";
import { formatSequenceNumber } from "../../../shared/ids.js";
import type { Clock } from "../../../shared/clock.js";
import type { AuditContext, AuditService } from "../../audit/application/auditService.js";
import {
  CollectionEngine,
  type CollectionActivityType,
} from "../domain/collectionEngine.js";
import { OverdueEngine } from "../../loan/domain/overdueEngine.js";

const SERVICING = ["ACTIVE", "DUE_SOON", "DUE", "OVERDUE", "DEFAULTED"];

export class CollectionService {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditService,
    private readonly clock: Clock
  ) {}

  /**
   * Opens (or refreshes) collection cases for every loan that is genuinely
   * past due. Safe to run repeatedly — it will not open a second case for a
   * loan that already has an open one.
   */
  async syncCasesForOverdueLoans(context: AuditContext) {
    const loans = await this.db.loan.findMany({
      where: { status: { in: SERVICING } },
      include: { scheduleLines: true, collectionCases: true },
    });

    const now = this.clock.now();
    const opened: string[] = [];

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

      if (!CollectionEngine.shouldOpenCase(evaluation.daysOverdue)) continue;

      const outstanding = Money.fromMinorUnits(
        loan.outstandingPrincipalCents + loan.outstandingInterestCents + loan.outstandingFeeCents
      );
      const priority = CollectionEngine.prioritise({
        daysOverdue: evaluation.daysOverdue,
        outstandingAmount: outstanding,
      });

      const openCase = loan.collectionCases.find((c) => !["CLOSED", "PAID"].includes(c.status));

      if (openCase) {
        await this.db.collectionCase.update({
          where: { id: openCase.id },
          data: {
            daysOverdue: evaluation.daysOverdue,
            outstandingAmountCents: outstanding.toMinorUnits(),
            priority,
          },
        });
        continue;
      }

      const sequence = (await this.db.collectionCase.count()) + 1;
      const created = await this.db.collectionCase.create({
        data: {
          caseNumber: formatSequenceNumber("COL", sequence),
          loanId: loan.id,
          customerId: loan.customerId,
          daysOverdue: evaluation.daysOverdue,
          outstandingAmountCents: outstanding.toMinorUnits(),
          priority,
          status: "OPEN",
          nextActionAt: addDays(now, CollectionEngine.nextActionIntervalDays(priority)),
        },
      });
      opened.push(created.id);

      await this.audit.record(context, {
        action: "COLLECTION_CASE_CREATED",
        resource: "CollectionCase",
        resourceId: created.id,
        after: { caseNumber: created.caseNumber, priority, daysOverdue: evaluation.daysOverdue },
        metadata: { loanId: loan.id },
      });
    }

    return { openedCaseIds: opened };
  }

  async createCaseForLoan(loanId: string, context: AuditContext) {
    const loan = await this.db.loan.findUnique({
      where: { id: loanId },
      include: { scheduleLines: true, collectionCases: true },
    });
    if (!loan) throw new LoanNotFoundError(loanId);

    const existing = loan.collectionCases.find((c) => !["CLOSED", "PAID"].includes(c.status));
    if (existing) return existing;

    const evaluation = OverdueEngine.evaluate({
      currentDate: this.clock.now(),
      scheduleLines: loan.scheduleLines.map((line) => ({
        installmentNumber: line.installmentNumber,
        dueDate: line.dueDate,
        totalDue: Money.fromMinorUnits(line.totalDueCents),
        totalPaid: Money.fromMinorUnits(
          line.principalPaidCents + line.interestPaidCents + line.feePaidCents
        ),
      })),
    });

    const outstanding = Money.fromMinorUnits(
      loan.outstandingPrincipalCents + loan.outstandingInterestCents + loan.outstandingFeeCents
    );
    const priority = CollectionEngine.prioritise({
      daysOverdue: evaluation.daysOverdue,
      outstandingAmount: outstanding,
    });
    const sequence = (await this.db.collectionCase.count()) + 1;

    const created = await this.db.collectionCase.create({
      data: {
        caseNumber: formatSequenceNumber("COL", sequence),
        loanId: loan.id,
        customerId: loan.customerId,
        daysOverdue: evaluation.daysOverdue,
        outstandingAmountCents: outstanding.toMinorUnits(),
        priority,
        status: "OPEN",
        nextActionAt: addDays(this.clock.now(), CollectionEngine.nextActionIntervalDays(priority)),
      },
    });

    await this.audit.record(context, {
      action: "COLLECTION_CASE_CREATED",
      resource: "CollectionCase",
      resourceId: created.id,
      after: { caseNumber: created.caseNumber, priority },
      metadata: { loanId },
    });

    return created;
  }

  async addActivity(
    caseId: string,
    input: { type: CollectionActivityType; result?: string; note?: string; nextActionAt?: string },
    context: AuditContext
  ) {
    const collectionCase = await this.db.collectionCase.findUnique({ where: { id: caseId } });
    if (!collectionCase) throw new CollectionCaseNotFoundError(caseId);

    const activity = await this.db.collectionActivity.create({
      data: {
        collectionCaseId: caseId,
        type: input.type,
        result: input.result ?? null,
        note: input.note ?? null,
        createdBy: context.userId ?? "system",
        nextActionAt: input.nextActionAt ? new Date(input.nextActionAt) : null,
      },
    });

    // Logging contact moves an untouched case into progress.
    await this.db.collectionCase.update({
      where: { id: caseId },
      data: {
        status: collectionCase.status === "OPEN" ? "IN_PROGRESS" : collectionCase.status,
        nextActionAt: input.nextActionAt ? new Date(input.nextActionAt) : collectionCase.nextActionAt,
      },
    });

    await this.audit.record(context, {
      action: "COLLECTION_ACTIVITY_CREATED",
      resource: "CollectionActivity",
      resourceId: activity.id,
      after: { type: activity.type, result: activity.result },
      metadata: { collectionCaseId: caseId },
    });

    return activity;
  }

  async addPromiseToPay(
    caseId: string,
    input: { amount: string | number; promisedDate: string },
    context: AuditContext
  ) {
    const collectionCase = await this.db.collectionCase.findUnique({ where: { id: caseId } });
    if (!collectionCase) throw new CollectionCaseNotFoundError(caseId);

    const amount = Money.fromMajorUnits(input.amount);
    if (!amount.isPositive()) throw new ValidationError("Promised amount must be positive");

    const promise = await this.db.promiseToPay.create({
      data: {
        collectionCaseId: caseId,
        promisedAmountCents: amount.toMinorUnits(),
        promisedDate: new Date(input.promisedDate),
        status: "PENDING",
        createdBy: context.userId ?? "system",
      },
    });

    await this.db.collectionCase.update({
      where: { id: caseId },
      data: { status: "PROMISE_TO_PAY", nextActionAt: new Date(input.promisedDate) },
    });

    await this.audit.record(context, {
      action: "PROMISE_TO_PAY_CREATED",
      resource: "PromiseToPay",
      resourceId: promise.id,
      after: {
        amount: amount.toMajorUnitsString(),
        promisedDate: promise.promisedDate,
      },
      metadata: { collectionCaseId: caseId },
    });

    return promise;
  }

  async assign(caseId: string, userId: string | null, context: AuditContext) {
    const collectionCase = await this.db.collectionCase.findUnique({ where: { id: caseId } });
    if (!collectionCase) throw new CollectionCaseNotFoundError(caseId);

    const updated = await this.db.collectionCase.update({
      where: { id: caseId },
      data: { assignedUserId: userId },
    });

    await this.audit.record(context, {
      action: "COLLECTION_ACTIVITY_CREATED",
      resource: "CollectionCase",
      resourceId: caseId,
      before: { assignedUserId: collectionCase.assignedUserId },
      after: { assignedUserId: userId },
    });

    return updated;
  }

  async getById(id: string) {
    const collectionCase = await this.db.collectionCase.findUnique({
      where: { id },
      include: {
        activities: { orderBy: { createdAt: "desc" } },
        promises: { orderBy: { promisedDate: "desc" } },
        loan: { include: { scheduleLines: { orderBy: { installmentNumber: "asc" } } } },
        customer: { select: { id: true, name: true, customerNumber: true, phone: true } },
        assignedUser: { select: { id: true, displayName: true } },
      },
    });
    if (!collectionCase) throw new CollectionCaseNotFoundError(id);
    return collectionCase;
  }

  async list(params: {
    status?: string;
    priority?: string;
    assignedUserId?: string;
    take?: number;
    skip?: number;
  }) {
    const where: Prisma.CollectionCaseWhereInput = {};
    if (params.status) where.status = params.status;
    if (params.priority) where.priority = params.priority;
    if (params.assignedUserId) where.assignedUserId = params.assignedUserId;

    const [items, total] = await Promise.all([
      this.db.collectionCase.findMany({
        where,
        orderBy: [{ priority: "desc" }, { daysOverdue: "desc" }],
        take: params.take ?? 25,
        skip: params.skip ?? 0,
        include: {
          loan: { select: { id: true, loanNumber: true, status: true } },
          customer: { select: { id: true, name: true, customerNumber: true, phone: true } },
          assignedUser: { select: { id: true, displayName: true } },
          activities: { orderBy: { createdAt: "desc" }, take: 1 },
          promises: { where: { status: "PENDING" } },
        },
      }),
      this.db.collectionCase.count({ where }),
    ]);
    return { items, total };
  }

  /** KPIs for the collections dashboard (§41), all derived from live records. */
  async dashboard() {
    const now = this.clock.now();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const [openCases, highRisk, duePromises, todayFollowUps] = await Promise.all([
      this.db.collectionCase.findMany({
        where: { status: { notIn: ["CLOSED", "PAID"] } },
        select: { outstandingAmountCents: true, daysOverdue: true },
      }),
      this.db.collectionCase.count({
        where: { status: { notIn: ["CLOSED", "PAID"] }, priority: { in: ["HIGH", "CRITICAL"] } },
      }),
      this.db.promiseToPay.count({ where: { status: "PENDING" } }),
      this.db.collectionCase.count({
        where: { status: { notIn: ["CLOSED", "PAID"] }, nextActionAt: { lte: endOfToday } },
      }),
    ]);

    const overduePrincipal = Money.sum(
      openCases.map((c) => Money.fromMinorUnits(c.outstandingAmountCents))
    );

    // Recovered = payments taken on loans that have a collection case.
    const recoveredPayments = await this.db.payment.findMany({
      where: { status: "CONFIRMED", loan: { collectionCases: { some: {} } } },
      select: { amountCents: true },
    });
    const recovered = Money.sum(recoveredPayments.map((p) => Money.fromMinorUnits(p.amountCents)));

    return {
      openCases: openCases.length,
      overdueAmount: overduePrincipal.toMajorUnitsString(),
      highRiskCases: highRisk,
      pendingPromises: duePromises,
      todayFollowUps,
      recoveredAmount: recovered.toMajorUnitsString(),
    };
  }
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
