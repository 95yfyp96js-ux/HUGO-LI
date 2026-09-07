import type { PrismaClient } from "@prisma/client";
import { Money } from "../../../shared/money.js";
import { InvalidLoanStateError, LoanNotFoundError, ValidationError } from "../../../shared/errors.js";
import { formatSequenceNumber } from "../../../shared/ids.js";
import type { Clock } from "../../../shared/clock.js";
import type { AuditContext, AuditService } from "../../audit/application/auditService.js";
import { LoanStateMachine, type LoanStatus } from "../../loan/domain/loanStateMachine.js";
import { RepaymentEngine, type RepaymentMethod } from "../../repayment/domain/repaymentEngine.js";

const SERVICING = ["ACTIVE", "DUE_SOON", "DUE", "OVERDUE", "DEFAULTED"];

export interface RenewInput {
  /** Extra cash advanced to the customer on top of rolling the existing balance. */
  additionalAmount?: string | number;
  termMonths?: number;
  reason: string;
  idempotencyKey?: string;
}

export interface ExtendInput {
  extensionMonths: number;
  fee?: string | number;
  reason: string;
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
    private readonly clock: Clock
  ) {}

  async renew(loanId: string, input: RenewInput, context: AuditContext) {
    if (!input.reason?.trim()) throw new ValidationError("A renewal reason is required");

    const previous = await this.db.loan.findUnique({
      where: { id: loanId },
      include: { snapshot: true, renewalAsNew: true },
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

    const schedule = RepaymentEngine.generateSchedule({
      principal: newPrincipal,
      ratePercent: snapshot.ratePercent,
      termMonths,
      startDate,
      repaymentMethod: snapshot.repaymentMethod as RepaymentMethod,
    });
    const maturityDate = schedule.installments[schedule.installments.length - 1]!.dueDate;

    // The chain root: renewing a renewal still points back to loan #1.
    const originalLoanId = previous.renewalAsNew?.originalLoanId ?? previous.id;
    const loanSequence = (await this.db.loan.count()) + 1;

    const applicationSequence = (await this.db.lendingApplication.count()) + 1;

    const result = await this.db.$transaction(async (tx) => {
      // Invariant §74.2: every loan originates from an approved application.
      // A renewal is a fresh credit decision on new terms, so it gets its own
      // application and approval record rather than reusing (and corrupting)
      // the history of the original enquiry.
      const renewalApplication = await tx.lendingApplication.create({
        data: {
          applicationNumber: formatSequenceNumber("APP", applicationSequence),
          customerId: previous.customerId,
          requestedProductId: previous.productId,
          requestedAmountCents: newPrincipal.toMinorUnits(),
          requestedTermMonths: termMonths,
          purpose: `續借自 ${previous.loanNumber}`,
          status: "APPROVED",
        },
      });

      await tx.loanApproval.create({
        data: {
          applicationId: renewalApplication.id,
          decision: "APPROVED",
          approvedAmountCents: newPrincipal.toMinorUnits(),
          approvedTermMonths: termMonths,
          approvedRatePercent: snapshot.ratePercent,
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

      await tx.loanSnapshot.create({
        data: {
          loanId: newLoan.id,
          principalCents: newPrincipal.toMinorUnits(),
          ratePercent: snapshot.ratePercent,
          rateUnit: snapshot.rateUnit,
          calculationMethod: snapshot.calculationMethod,
          termMonths,
          repaymentMethod: snapshot.repaymentMethod,
          productId: snapshot.productId,
          productVersion: snapshot.productVersion,
          feeRules: snapshot.feeRules,
          pricingVersion: snapshot.pricingVersion,
          riskAssessmentVersion: snapshot.riskAssessmentVersion,
          approvalVersion: snapshot.approvalVersion,
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
      LoanStateMachine.assertTransition(previous.status as LoanStatus, "RESTRUCTURED");
      await tx.loan.update({
        where: { id: previous.id },
        data: {
          status: "RESTRUCTURED",
          outstandingPrincipalCents: 0,
          outstandingInterestCents: 0,
          outstandingFeeCents: 0,
        },
      });

      const renewal = await tx.renewal.create({
        data: {
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
          },
          reason: input.reason,
          metadata: { originalLoanId, previousLoanId: previous.id, newLoanId: newLoan.id },
        },
        tx
      );

      return { renewal, newLoan };
    });

    return result;
  }

  async extend(loanId: string, input: ExtendInput, context: AuditContext) {
    if (!input.reason?.trim()) throw new ValidationError("An extension reason is required");
    if (input.extensionMonths <= 0) throw new ValidationError("extensionMonths must be positive");

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

    return result;
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
