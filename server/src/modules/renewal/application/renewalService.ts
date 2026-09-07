import type { PrismaClient } from "@prisma/client";
import { Money } from "../../../shared/money.js";
import { InvalidLoanStateError, LoanNotFoundError, ValidationError } from "../../../shared/errors.js";
import { formatSequenceNumber } from "../../../shared/ids.js";
import type { Clock } from "../../../shared/clock.js";
import type { AuditContext, AuditService } from "../../audit/application/auditService.js";
import { LoanStateMachine, type LoanStatus } from "../../loan/domain/loanStateMachine.js";
import { RepaymentEngine, type RepaymentMethod } from "../../repayment/domain/repaymentEngine.js";
import type { RiskService } from "../../risk/application/riskService.js";
import type { PricingService } from "../../pricing/application/pricingService.js";
import type { RiskGrade } from "../../risk/domain/riskEngine.js";
import { RenewalNotPermittedError } from "../../../shared/errors.js";

const SERVICING = ["ACTIVE", "DUE_SOON", "DUE", "OVERDUE", "DEFAULTED"];

export interface RenewInput {
  /** Extra cash advanced to the customer on top of rolling the existing balance. */
  additionalAmount?: string | number;
  termMonths?: number;
  reason: string;
  idempotencyKey: string;
}

export interface ExtendInput {
  extensionMonths: number;
  fee?: string | number;
  reason: string;
  idempotencyKey: string;
}

/**
 * Renewal creates a NEW loan and closes the old one, preserving the old
 * loan's history verbatim (§29). Extension keeps the SAME loan and pushes its
 * maturity out (§30). They are deliberately different operations.
 */
export class RenewalService {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly risk: RiskService,
    private readonly pricing: PricingService
  ) {}

  async renew(loanId: string, input: RenewInput, context: AuditContext) {
    if (!input.reason?.trim()) throw new ValidationError("A renewal reason is required");
    if (!input.idempotencyKey) {
      throw new ValidationError("Idempotency-Key is required to renew a loan");
    }

    // A renewal writes a new loan carrying the old balance forward, so a
    // retried request used to lend the same money twice. The key is stored on
    // the Renewal row under a unique index, which is what actually prevents
    // it; this lookup just turns the second attempt into a replay instead of
    // a constraint error.
    const replayed = await this.replayRenewal(input.idempotencyKey);
    if (replayed) return replayed;

    const previous = await this.db.loan.findUnique({
      where: { id: loanId },
      include: { snapshot: true, renewalAsNew: true, customer: true },
    });
    if (!previous) throw new LoanNotFoundError(loanId);
    if (!SERVICING.includes(previous.status)) {
      throw new InvalidLoanStateError(loanId, previous.status, "RENEW");
    }
    if (!previous.snapshot) {
      throw new ValidationError("Loan has no snapshot and cannot be renewed", { loanId });
    }

    const carriedBalance = Money.fromMinorUnits(
      previous.outstandingPrincipalCents + previous.outstandingInterestCents + previous.outstandingFeeCents
    );
    const additional = input.additionalAmount ? Money.fromMajorUnits(input.additionalAmount) : Money.zero();
    const newPrincipal = carriedBalance.add(additional);

    if (!newPrincipal.isPositive()) {
      throw new ValidationError("Renewal principal must be positive", { loanId });
    }

    const snapshot = previous.snapshot;
    const termMonths = input.termMonths ?? snapshot.termMonths;
    const startDate = this.clock.now();

    const product = await this.db.loanProduct.findUniqueOrThrow({
      where: { id: previous.productId },
    });

    // ---- Re-underwrite ----------------------------------------------------
    // A renewal is a NEW credit decision, not a copy of the old one. The
    // customer's position has moved since the original loan — that is usually
    // why they are renewing — so risk, limit and price are all recomputed
    // from current internal data. Nothing is carried over from the previous
    // assessment.
    const applicationSequence = (await this.db.lendingApplication.count()) + 1;
    const exposureExcludingThisLoan = await this.risk.currentExposure(
      previous.customerId,
      previous.id
    );

    // Created as a DRAFT: if the loan transaction below fails, what is left
    // behind looks like an abandoned application, not an approved one.
    const renewalApplication = await this.db.lendingApplication.create({
      data: {
        applicationNumber: formatSequenceNumber("APP", applicationSequence),
        customerId: previous.customerId,
        requestedProductId: previous.productId,
        requestedAmountCents: newPrincipal.toMinorUnits(),
        requestedTermMonths: termMonths,
        purpose: `續借自 ${previous.loanNumber}`,
        incomeCents: previous.customer.monthlyIncomeCents,
        existingDebtCents: exposureExcludingThisLoan.toMinorUnits(),
        status: "DRAFT",
      },
    });

    const assessment = await this.risk.assessApplication(renewalApplication.id, context);
    const limit = await this.risk.calculateLimit(renewalApplication.id, assessment.id, context, {
      excludeLoanId: previous.id,
    });

    // Rolling an existing balance forward is not new lending, so the limit
    // does not block it — refusing would not make the debt disappear, it
    // would strand the customer on a loan they already cannot service. New
    // money advanced on top IS new lending and must fit the limit and pass
    // the risk decision.
    if (additional.isPositive()) {
      if (assessment.decision === "REJECT") {
        throw new RenewalNotPermittedError(
          "Cannot advance additional funds: the customer's current risk assessment is a decline",
          { loanId, riskGrade: assessment.grade, riskDecision: assessment.decision }
        );
      }
      const availableLimit = Money.fromMinorUnits(limit.availableLimitCents);
      if (additional.greaterThan(availableLimit)) {
        throw new RenewalNotPermittedError(
          "Cannot advance additional funds: the amount exceeds the customer's available limit",
          {
            loanId,
            additionalAmount: additional.toMajorUnitsString(),
            availableLimit: availableLimit.toMajorUnitsString(),
          }
        );
      }
    }

    // Priced against the NEW grade, so a customer whose position deteriorated
    // is renewed on terms that reflect it.
    const offer = await this.pricing.createOffer(
      {
        applicationId: renewalApplication.id,
        approvedAmount: newPrincipal,
        termMonths,
        riskGrade: assessment.grade as RiskGrade,
        // Already lent under this product; only new money is bound by its range.
        carriedAmount: carriedBalance,
      },
      context
    );

    const schedule = RepaymentEngine.generateSchedule({
      principal: newPrincipal,
      ratePercent: offer.ratePercent,
      termMonths,
      startDate,
      repaymentMethod: offer.repaymentMethod as RepaymentMethod,
    });
    const maturityDate = schedule.installments[schedule.installments.length - 1]!.dueDate;

    // The chain root: renewing a renewal still points back to loan #1.
    const originalLoanId = previous.renewalAsNew?.originalLoanId ?? previous.id;
    const loanSequence = (await this.db.loan.count()) + 1;

    const result = await this.db.$transaction(async (tx) => {
      // Invariant §74.2: every loan originates from an approved application.
      // The renewal's own application (underwritten above) is approved here,
      // leaving the original enquiry's history untouched.
      await tx.lendingApplication.update({
        where: { id: renewalApplication.id },
        data: { status: "APPROVED" },
      });

      const approval = await tx.loanApproval.create({
        data: {
          applicationId: renewalApplication.id,
          loanOfferId: offer.id,
          decision: "APPROVED",
          approvedAmountCents: newPrincipal.toMinorUnits(),
          approvedTermMonths: termMonths,
          approvedRatePercent: offer.ratePercent,
          conditions: "[]",
          reason: input.reason,
          approvedBy: context.userId,
          approvedAt: startDate,
        },
      });

      const newLoan = await tx.loan.create({
        data: {
          loanNumber: formatSequenceNumber("LN", loanSequence),
          customerId: previous.customerId,
          applicationId: renewalApplication.id,
          productId: previous.productId,
          principalCents: newPrincipal.toMinorUnits(),
          outstandingPrincipalCents: newPrincipal.toMinorUnits(),
          outstandingInterestCents: schedule.totalInterest.toMinorUnits(),
          outstandingFeeCents: 0,
          status: "ACTIVE",
          startDate,
          maturityDate,
        },
      });

      // The new loan's terms come from its own offer and approval, never from
      // the previous loan's snapshot.
      await tx.loanSnapshot.create({
        data: {
          loanId: newLoan.id,
          principalCents: newPrincipal.toMinorUnits(),
          ratePercent: offer.ratePercent,
          rateUnit: offer.rateUnit,
          calculationMethod: offer.calculationMethod,
          termMonths,
          repaymentMethod: offer.repaymentMethod,
          settlementPolicy: offer.settlementPolicy,
          productId: product.id,
          productVersion: product.version,
          feeRules: product.feeRules,
          pricingVersion: offer.pricingVersion,
          riskAssessmentVersion: assessment.modelVersion,
          approvalVersion: approval.id,
        },
      });

      await tx.scheduleLine.createMany({
        data: schedule.installments.map((installment) => ({
          loanId: newLoan.id,
          installmentNumber: installment.installmentNumber,
          dueDate: installment.dueDate,
          principalDueCents: installment.principalDue.toMinorUnits(),
          interestDueCents: installment.interestDue.toMinorUnits(),
          feeDueCents: installment.feeDue.toMinorUnits(),
          totalDueCents: installment.principalDue
            .add(installment.interestDue)
            .add(installment.feeDue)
            .toMinorUnits(),
        })),
      });

      const occurredAt = startDate;

      // Ledger: the old loan is discharged by the renewal, the new one is
      // advanced. Neither is deleted or rewritten.
      await tx.moneyEvent.create({
        data: {
          loanId: previous.id,
          customerId: previous.customerId,
          type: "SETTLEMENT",
          amountCents: carriedBalance.toMinorUnits(),
          referenceId: newLoan.id,
          occurredAt,
          createdBy: context.userId ?? "system",
          metadata: JSON.stringify({ basis: "renewed-into", newLoanId: newLoan.id }),
        },
      });

      await tx.moneyEvent.create({
        data: {
          loanId: newLoan.id,
          customerId: newLoan.customerId,
          type: "DISBURSEMENT",
          amountCents: newPrincipal.toMinorUnits(),
          referenceId: previous.id,
          occurredAt,
          createdBy: context.userId ?? "system",
          metadata: JSON.stringify({
            basis: "renewal",
            carriedBalance: carriedBalance.toMajorUnitsString(),
            additionalAdvance: additional.toMajorUnitsString(),
          }),
        },
      });

      if (schedule.totalInterest.isPositive()) {
        await tx.moneyEvent.create({
          data: {
            loanId: newLoan.id,
            customerId: newLoan.customerId,
            type: "INTEREST_ACCRUAL",
            amountCents: schedule.totalInterest.toMinorUnits(),
            occurredAt,
            createdBy: context.userId ?? "system",
            metadata: JSON.stringify({ basis: "scheduled-term-interest" }),
          },
        });
      }

      // Old loan closes as RESTRUCTURED — a terminal state, so its history
      // can never be modified again.
      //
      // Conditional on the status this renewal was underwritten against, not
      // an unconditional update by id. `previous.status` was read before any
      // of the underwriting above, so by now a concurrent renewal of the same
      // loan may already have closed it — and that renewal carried the same
      // balance forward. Without this, both commit and the customer owes the
      // same money on two new loans. Two concurrent renewals happened to
      // collide on a unique loan number instead, which is luck, not a rule.
      LoanStateMachine.assertTransition(previous.status as LoanStatus, "RESTRUCTURED");
      const closed = await tx.loan.updateMany({
        where: { id: previous.id, status: previous.status },
        data: {
          status: "RESTRUCTURED",
          outstandingPrincipalCents: 0,
          outstandingInterestCents: 0,
          outstandingFeeCents: 0,
        },
      });
      if (closed.count !== 1) {
        throw new InvalidLoanStateError(previous.id, previous.status, "RENEW");
      }

      const renewal = await tx.renewal.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          originalLoanId,
          previousLoanId: previous.id,
          newLoanId: newLoan.id,
          reason: input.reason,
          createdBy: context.userId ?? "system",
        },
      });

      await this.audit.record(
        context,
        {
          action: "RENEWAL_CREATED",
          resource: "Renewal",
          resourceId: renewal.id,
          after: {
            previousLoanNumber: previous.loanNumber,
            newLoanNumber: newLoan.loanNumber,
            carriedBalance: carriedBalance.toMajorUnitsString(),
            additionalAdvance: additional.toMajorUnitsString(),
            newPrincipal: newPrincipal.toMajorUnitsString(),
            // The renewal was re-underwritten; record what it was decided on.
            riskGrade: assessment.grade,
            riskScore: assessment.score,
            riskDecision: assessment.decision,
            previousRatePercent: snapshot.ratePercent,
            newRatePercent: offer.ratePercent,
          },
          reason: input.reason,
          metadata: {
            originalLoanId,
            previousLoanId: previous.id,
            newLoanId: newLoan.id,
            renewalApplicationId: renewalApplication.id,
            riskAssessmentId: assessment.id,
            lendingLimitId: limit.id,
            loanOfferId: offer.id,
          },
        },
        tx
      );

      return { renewal, newLoan };
    });

    return { ...result, replayed: false };
  }

  /**
   * Returns the original outcome of a renewal that already ran under this
   * key, so a retry is answered rather than refused.
   */
  private async replayRenewal(idempotencyKey: string) {
    const existing = await this.db.renewal.findUnique({
      where: { idempotencyKey },
      include: { newLoan: true },
    });
    if (!existing) return null;
    const { newLoan, ...renewal } = existing;
    return { renewal, newLoan, replayed: true as const };
  }

  async extend(loanId: string, input: ExtendInput, context: AuditContext) {
    if (!input.reason?.trim()) throw new ValidationError("An extension reason is required");
    if (input.extensionMonths <= 0) throw new ValidationError("extensionMonths must be positive");
    if (!input.idempotencyKey) {
      throw new ValidationError("Idempotency-Key is required to extend a loan");
    }

    // Without this a retry charged the extension fee again and pushed the
    // maturity date out a second time.
    const existing = await this.db.extension.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      const loan = await this.db.loan.findUniqueOrThrow({ where: { id: existing.loanId } });
      return { extension: existing, loan, replayed: true as const };
    }

    const loan = await this.db.loan.findUnique({
      where: { id: loanId },
      include: { scheduleLines: { orderBy: { installmentNumber: "asc" } }, snapshot: true },
    });
    if (!loan) throw new LoanNotFoundError(loanId);
    if (!SERVICING.includes(loan.status)) {
      throw new InvalidLoanStateError(loanId, loan.status, "EXTEND");
    }
    if (!loan.maturityDate) throw new ValidationError("Loan has no maturity date to extend", { loanId });

    const fee = input.fee ? Money.fromMajorUnits(input.fee) : Money.zero();
    const previousMaturity = loan.maturityDate;
    const newMaturity = new Date(previousMaturity.getTime());
    newMaturity.setMonth(newMaturity.getMonth() + input.extensionMonths);

    const result = await this.db.$transaction(async (tx) => {
      const extension = await tx.extension.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          loanId,
          previousMaturityDate: previousMaturity,
          newMaturityDate: newMaturity,
          extensionMonths: input.extensionMonths,
          feeCents: fee.toMinorUnits(),
          reason: input.reason,
          createdBy: context.userId ?? "system",
        },
      });

      // Push the remaining unpaid installments out by the extension period.
      const unpaidLines = loan.scheduleLines.filter(
        (line) =>
          line.principalPaidCents + line.interestPaidCents + line.feePaidCents < line.totalDueCents
      );
      for (const line of unpaidLines) {
        const shifted = new Date(line.dueDate.getTime());
        shifted.setMonth(shifted.getMonth() + input.extensionMonths);
        await tx.scheduleLine.update({
          where: { id: line.id },
          data: { dueDate: shifted, status: "PENDING" },
        });
      }

      if (fee.isPositive()) {
        await tx.moneyEvent.create({
          data: {
            loanId,
            customerId: loan.customerId,
            type: "FEE_CHARGE",
            amountCents: fee.toMinorUnits(),
            referenceId: extension.id,
            occurredAt: this.clock.now(),
            createdBy: context.userId ?? "system",
            metadata: JSON.stringify({ basis: "extension-fee" }),
          },
        });
      }

      const updatedLoan = await tx.loan.update({
        where: { id: loanId },
        data: {
          maturityDate: newMaturity,
          outstandingFeeCents: { increment: fee.toMinorUnits() },
          // Extending cures the immediate delinquency.
          status: "ACTIVE",
        },
      });

      await this.audit.record(
        context,
        {
          action: "EXTENSION_CREATED",
          resource: "Extension",
          resourceId: extension.id,
          before: { maturityDate: previousMaturity, status: loan.status },
          after: { maturityDate: newMaturity, status: "ACTIVE", fee: fee.toMajorUnitsString() },
          reason: input.reason,
          metadata: { loanId },
        },
        tx
      );

      return { extension, loan: updatedLoan };
    });

    return { ...result, replayed: false };
  }

  /** Walks the full renewal chain for any loan in it (§29 LoanChainService). */
  async getLoanChain(loanId: string) {
    const loan = await this.db.loan.findUnique({
      where: { id: loanId },
      include: { renewalAsNew: true },
    });
    if (!loan) throw new LoanNotFoundError(loanId);

    const originalLoanId = loan.renewalAsNew?.originalLoanId ?? loan.id;

    const renewals = await this.db.renewal.findMany({
      where: { originalLoanId },
      orderBy: { createdAt: "asc" },
      include: {
        previousLoan: { select: { id: true, loanNumber: true, status: true, principalCents: true } },
        newLoan: { select: { id: true, loanNumber: true, status: true, principalCents: true } },
      },
    });

    const original = await this.db.loan.findUniqueOrThrow({
      where: { id: originalLoanId },
      select: { id: true, loanNumber: true, status: true, principalCents: true, createdAt: true },
    });

    return {
      originalLoanId,
      chain: [
        {
          loanId: original.id,
          loanNumber: original.loanNumber,
          status: original.status,
          principal: Money.fromMinorUnits(original.principalCents).toMajorUnitsString(),
          sequence: 0,
        },
        ...renewals.map((r, index) => ({
          loanId: r.newLoan.id,
          loanNumber: r.newLoan.loanNumber,
          status: r.newLoan.status,
          principal: Money.fromMinorUnits(r.newLoan.principalCents).toMajorUnitsString(),
          sequence: index + 1,
          renewalId: r.id,
          renewedFrom: r.previousLoan.loanNumber,
          reason: r.reason,
          createdAt: r.createdAt,
        })),
      ],
    };
  }

  async listRenewals(params: { take?: number; skip?: number }) {
    const [items, total] = await Promise.all([
      this.db.renewal.findMany({
        orderBy: { createdAt: "desc" },
        take: params.take ?? 25,
        skip: params.skip ?? 0,
        include: {
          previousLoan: {
            select: {
              id: true,
              loanNumber: true,
              customer: { select: { id: true, name: true, customerNumber: true } },
            },
          },
          newLoan: { select: { id: true, loanNumber: true, principalCents: true, status: true } },
        },
      }),
      this.db.renewal.count(),
    ]);
    return { items, total };
  }
}
