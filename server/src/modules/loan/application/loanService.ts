import type { Prisma, PrismaClient } from "@prisma/client";
import { Money } from "../../../shared/money.js";
import {
  ApplicationNotFoundError,
  CustomerNotFoundError,
  InvalidLoanStateError,
  LoanNotFoundError,
  ProductNotFoundError,
  ValidationError,
} from "../../../shared/errors.js";
import { formatSequenceNumber } from "../../../shared/ids.js";
import type { Clock } from "../../../shared/clock.js";
import type { AuditContext, AuditService } from "../../audit/application/auditService.js";
import { LoanStateMachine, type LoanStatus } from "../domain/loanStateMachine.js";
import { RepaymentEngine, type RepaymentMethod, type TermUnit } from "../../repayment/domain/repaymentEngine.js";
import type { RateUnit } from "../../repayment/domain/interestEngine.js";
import { BalanceEngine, type LedgerEntry } from "../domain/balanceEngine.js";
import { OverdueEngine } from "../domain/overdueEngine.js";
import type { DisbursementProvider } from "../../disbursement/domain/disbursementProvider.js";
import { assertDayOpen } from "../../shop/application/dailyCloseService.js";
import type { ShopSettingsService } from "../../shop/application/shopSettingsService.js";

const SERVICING = ["ACTIVE", "DUE_SOON", "DUE", "OVERDUE", "DEFAULTED"];

/** Repayment methods a freeform loan slip may choose (§ loan slip). */
const SLIP_REPAYMENT_METHODS = [
  "BULLET",
  "PRINCIPAL_AND_INTEREST",
  "EQUAL_INSTALLMENT",
  "INTEREST_ONLY",
] as const;
type SlipRepaymentMethod = (typeof SLIP_REPAYMENT_METHODS)[number];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetweenDates(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/** Whole calendar months between two dates, the same convention used to lay out monthly installments. */
function monthsBetweenDates(a: Date, b: Date): number {
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months -= 1;
  return months;
}

/** 期利率 (PERIOD) is a rate already quoted per a custom N-day period the officer names on the spot. */
export type SlipRateUnit = "DAILY" | "MONTHLY" | "ANNUAL" | "PERIOD";

export interface IssueLoanSlipInput {
  customerId: string;
  /** Prefill only — never a requirement. Null/omitted means no product at all. */
  templateProductId?: string | null;
  principal: string | number;
  /** Defaults to now. */
  disbursedAt?: string;
  rateUnit: SlipRateUnit;
  ratePercent: number;
  /** Required, positive, when rateUnit is PERIOD: how many days is "one period". */
  periodDays?: number;
  /** 逾期利率 — recorded for reference; not automatically applied to the balance. */
  overdueRatePercent?: number | null;
  repaymentMethod: SlipRepaymentMethod;
  /** POST_PAID is the only implemented value; PRE_PAID is refused explicitly. */
  interestTiming: "PRE_PAID" | "POST_PAID";
  /** Either termCount or maturityDate is required; termCount wins if both are given. */
  termCount?: number;
  maturityDate?: string;
  idempotencyKey: string;
}

function resolveSlipTermCount(input: IssueLoanSlipInput, termUnit: TermUnit, disbursedAt: Date): number {
  if (input.termCount !== undefined && input.termCount !== null) {
    if (!Number.isInteger(input.termCount) || input.termCount <= 0) {
      throw new ValidationError("termCount must be a positive integer");
    }
    return input.termCount;
  }
  if (input.maturityDate) {
    const maturity = new Date(input.maturityDate);
    if (Number.isNaN(maturity.getTime())) {
      throw new ValidationError("maturityDate is invalid", { maturityDate: input.maturityDate });
    }
    const count =
      termUnit === "DAY" ? daysBetweenDates(disbursedAt, maturity) : monthsBetweenDates(disbursedAt, maturity);
    if (count <= 0) {
      throw new ValidationError("到期日必須晚於放款日", {
        disbursedAt: disbursedAt.toISOString(),
        maturityDate: input.maturityDate,
      });
    }
    return count;
  }
  throw new ValidationError("請提供到期日或天數（termCount 或 maturityDate 擇一必填）");
}

export class LoanService {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly disbursementProvider: DisbursementProvider,
    private readonly shopSettings: ShopSettingsService
  ) {}

  /**
   * Invariants §74.2-3: a loan may only be created from an APPROVED
   * application, exactly once. Loan + snapshot + schedule are written in one
   * transaction — a loan with no schedule is not a thing that may exist.
   */
  async createFromApprovedApplication(applicationId: string, context: AuditContext) {
    const application = await this.db.lendingApplication.findUnique({
      where: { id: applicationId },
      include: {
        requestedProduct: true,
        approvals: { orderBy: { createdAt: "desc" }, take: 1 },
        riskAssessments: { orderBy: { createdAt: "desc" }, take: 1 },
        loanOffers: { orderBy: { createdAt: "desc" }, take: 1 },
        loan: true,
      },
    });
    if (!application) throw new ApplicationNotFoundError(applicationId);

    if (application.status !== "APPROVED") {
      throw new ValidationError("A loan can only be created from an APPROVED application", {
        applicationId,
        status: application.status,
      });
    }
    if (application.loan) {
      throw new ValidationError("This application already has a loan", {
        applicationId,
        loanId: application.loan.id,
      });
    }

    // This path always comes from a priced offer, and LendingApplicationService
    // .create requires a product to be priced against — a freeform loan slip
    // is created directly by issueLoanSlip and never reaches here.
    if (!application.requestedProduct) {
      throw new ValidationError("Application has no requested product", { applicationId });
    }
    // Captured into a local so the narrowing above survives into the
    // transaction closure below, which TypeScript cannot see through.
    const requestedProduct = application.requestedProduct;

    const approval = application.approvals[0];
    const offer = application.loanOffers[0];
    const assessment = application.riskAssessments[0];
    if (!approval || !offer) {
      throw new ValidationError("Application is missing its approval or priced offer", { applicationId });
    }

    const principal = Money.fromMinorUnits(approval.approvedAmountCents ?? offer.approvedAmountCents);
    const termCount = approval.approvedTermCount ?? offer.termCount;
    const ratePercent = approval.approvedRatePercent ?? offer.ratePercent;
    const startDate = this.clock.now();

    // The offer's unit, not the product's current one: repricing the product
    // between offer and drawdown must not change what was agreed.
    const termUnit = offer.termUnit as TermUnit;
    const schedule = RepaymentEngine.generateSchedule({
      principal,
      ratePercent,
      rateUnit: offer.rateUnit as RateUnit,
      termCount,
      termUnit,
      startDate,
      repaymentMethod: offer.repaymentMethod as RepaymentMethod,
    });

    const maturityDate = schedule.installments[schedule.installments.length - 1]!.dueDate;
    const sequence = (await this.db.loan.count()) + 1;

    const loan = await this.db.$transaction(async (tx) => {
      const created = await tx.loan.create({
        data: {
          loanNumber: formatSequenceNumber("LN", sequence),
          customerId: application.customerId,
          applicationId: application.id,
          productId: application.requestedProductId,
          principalCents: principal.toMinorUnits(),
          // Nothing is owed until the money actually goes out the door.
          outstandingPrincipalCents: 0,
          outstandingInterestCents: 0,
          outstandingFeeCents: 0,
          status: "CREATED",
          startDate,
          maturityDate,
        },
      });

      // The snapshot freezes today's product/pricing terms onto this loan so
      // a later product repricing cannot rewrite an existing contract.
      await tx.loanSnapshot.create({
        data: {
          loanId: created.id,
          principalCents: principal.toMinorUnits(),
          ratePercent,
          rateUnit: offer.rateUnit,
          calculationMethod: offer.calculationMethod,
          termCount,
          termUnit,
          repaymentMethod: offer.repaymentMethod,
          // Frozen with the rest of the terms: repricing the product later
          // cannot change what settling this loan early costs.
          settlementPolicy: offer.settlementPolicy,
          productId: application.requestedProductId,
          productVersion: requestedProduct.version,
          feeRules: requestedProduct.feeRules,
          pricingVersion: offer.pricingVersion,
          riskAssessmentVersion: assessment?.modelVersion ?? "none",
          approvalVersion: approval.id,
        },
      });

      await tx.scheduleLine.createMany({
        data: schedule.installments.map((installment) => ({
          loanId: created.id,
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

      const ready = await tx.loan.update({
        where: { id: created.id },
        data: { status: "READY_FOR_DISBURSEMENT" },
      });

      await this.audit.record(
        context,
        {
          action: "LOAN_CREATED",
          resource: "Loan",
          resourceId: created.id,
          after: {
            loanNumber: created.loanNumber,
            principal: principal.toMajorUnitsString(),
            ratePercent,
            termCount,
            repaymentMethod: offer.repaymentMethod,
            maturityDate,
          },
          metadata: { applicationId, approvalId: approval.id, offerId: offer.id },
        },
        tx
      );

      return ready;
    });

    return this.getById(loan.id);
  }

  /**
   * 一筆借據一張單 — a freeform loan slip. Every term is filled in by hand on
   * the spot rather than looked up from a product: the product is at most a
   * prefill template (templateProductId), never a requirement. This skips
   * the risk/limit/pricing/approval pipeline entirely — there is no
   * automated underwriting decision here, the person writing the slip IS the
   * decision — but still writes a synthetic APPROVED LendingApplication so
   * every existing invariant that hangs off Loan.applicationId keeps
   * holding, and still runs the same RepaymentEngine every other loan does,
   * so the schedule math is never duplicated.
   *
   * Loan + snapshot + schedule are written in one transaction, same as
   * createFromApprovedApplication; disbursement is a separate, already
   * idempotent step (LoanService.disburse) the caller triggers next.
   */
  async issueLoanSlip(input: IssueLoanSlipInput, context: AuditContext) {
    if (!input.idempotencyKey) {
      throw new ValidationError("Idempotency-Key is required to issue a loan slip");
    }

    const existingApplication = await this.db.lendingApplication.findUnique({
      where: { slipIdempotencyKey: input.idempotencyKey },
    });
    if (existingApplication) {
      const existingLoan = await this.db.loan.findUnique({
        where: { applicationId: existingApplication.id },
      });
      if (existingLoan) return { loan: await this.getById(existingLoan.id), replayed: true };
    }

    const customer = await this.db.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw new CustomerNotFoundError(input.customerId);

    const principal = Money.fromMajorUnits(input.principal);
    if (!principal.isPositive()) throw new ValidationError("principal must be positive");

    if (!SLIP_REPAYMENT_METHODS.includes(input.repaymentMethod)) {
      throw new ValidationError("Unsupported repayment method for a loan slip", {
        repaymentMethod: input.repaymentMethod,
        allowed: SLIP_REPAYMENT_METHODS,
      });
    }
    if (!["DAILY", "MONTHLY", "ANNUAL", "PERIOD"].includes(input.rateUnit)) {
      throw new ValidationError("rateUnit must be DAILY, MONTHLY, ANNUAL or PERIOD", {
        rateUnit: input.rateUnit,
      });
    }
    if (typeof input.ratePercent !== "number" || !Number.isFinite(input.ratePercent) || input.ratePercent < 0) {
      throw new ValidationError("ratePercent must be zero or positive");
    }
    if (input.rateUnit === "PERIOD") {
      if (!Number.isInteger(input.periodDays) || (input.periodDays as number) <= 0) {
        throw new ValidationError("periodDays（一期幾天）must be a positive integer when rateUnit is PERIOD", {
          periodDays: input.periodDays,
        });
      }
      if (input.termCount === undefined || input.termCount === null) {
        throw new ValidationError("termCount（期數）is required when rateUnit is PERIOD", {
          rateUnit: input.rateUnit,
        });
      }
    }
    if (input.overdueRatePercent != null && input.overdueRatePercent < 0) {
      throw new ValidationError("overdueRatePercent must be zero or positive");
    }
    // 先收息 (interest deducted from the disbursed amount up front) has no
    // support anywhere in the disbursement or schedule engines — disburse()
    // always pays out the full principal, and the schedule always bills
    // interest through the installments. Refusing here is the honest
    // answer; silently treating it as 後收息 would not be.
    if (input.interestTiming === "PRE_PAID") {
      throw new ValidationError(
        "先收息（撥款時從本金先扣除利息）目前系統尚未實作，請選擇後收息",
        { interestTiming: "PRE_PAID" }
      );
    }
    if (input.interestTiming !== "POST_PAID") {
      throw new ValidationError("interestTiming must be PRE_PAID or POST_PAID", {
        interestTiming: input.interestTiming,
      });
    }

    // Shop-wide rate ceiling (店規) applies here exactly as it does to a
    // priced product or a manager's approval override — a freeform slip is
    // not a way around it. A PERIOD rate has no direct monthly-equivalent
    // conversion of its own, so it is checked via its daily equivalent —
    // the same arithmetic periodRate already uses for DAILY, just computed
    // once here first.
    if (input.rateUnit === "PERIOD") {
      await this.shopSettings.assertWithinCap(input.ratePercent / input.periodDays!, "DAILY");
    } else {
      await this.shopSettings.assertWithinCap(input.ratePercent, input.rateUnit as RateUnit);
    }

    const termUnit: TermUnit = input.rateUnit === "MONTHLY" || input.rateUnit === "ANNUAL" ? "MONTH" : "DAY";
    const disbursedAt = input.disbursedAt ? new Date(input.disbursedAt) : this.clock.now();
    if (Number.isNaN(disbursedAt.getTime())) {
      throw new ValidationError("disbursedAt is invalid", { disbursedAt: input.disbursedAt });
    }
    const termCount =
      input.rateUnit === "PERIOD" ? (input.termCount as number) : resolveSlipTermCount(input, termUnit, disbursedAt);

    let template: { id: string; version: number } | null = null;
    if (input.templateProductId) {
      const product = await this.db.loanProduct.findUnique({ where: { id: input.templateProductId } });
      if (!product) throw new ProductNotFoundError(input.templateProductId);
      template = product;
    }

    const schedule = RepaymentEngine.generateSchedule({
      principal,
      ratePercent: input.ratePercent,
      termCount,
      startDate: disbursedAt,
      repaymentMethod: input.repaymentMethod,
      termUnit,
      rateUnit: input.rateUnit === "PERIOD" ? "DAILY" : input.rateUnit,
      periodDays: input.rateUnit === "PERIOD" ? input.periodDays : undefined,
    });

    const maturityDate = schedule.installments[schedule.installments.length - 1]!.dueDate;
    const applicationSequence = (await this.db.lendingApplication.count()) + 1;
    const loanSequence = (await this.db.loan.count()) + 1;

    const created = await this.db.$transaction(async (tx) => {
      const application = await tx.lendingApplication.create({
        data: {
          applicationNumber: formatSequenceNumber("APP", applicationSequence),
          customerId: customer.id,
          requestedProductId: template?.id ?? null,
          requestedAmountCents: principal.toMinorUnits(),
          requestedTermCount: termCount,
          purpose: "放款單（一筆借據一張單）",
          status: "APPROVED",
          slipIdempotencyKey: input.idempotencyKey,
        },
      });

      const loan = await tx.loan.create({
        data: {
          loanNumber: formatSequenceNumber("LN", loanSequence),
          customerId: customer.id,
          applicationId: application.id,
          productId: template?.id ?? null,
          principalCents: principal.toMinorUnits(),
          // Nothing is owed until the money actually goes out the door.
          outstandingPrincipalCents: 0,
          outstandingInterestCents: 0,
          outstandingFeeCents: 0,
          status: "CREATED",
          startDate: disbursedAt,
          maturityDate,
        },
      });

      await tx.loanSnapshot.create({
        data: {
          loanId: loan.id,
          principalCents: principal.toMinorUnits(),
          ratePercent: input.ratePercent,
          rateUnit: input.rateUnit,
          calculationMethod: "SIMPLE_INTEREST",
          termCount,
          termUnit,
          repaymentMethod: input.repaymentMethod,
          settlementPolicy: "FULL_CONTRACT_INTEREST",
          productId: template?.id ?? null,
          productVersion: template?.version ?? null,
          feeRules: "[]",
          pricingVersion: "manual",
          riskAssessmentVersion: "none",
          approvalVersion: "manual-slip",
          overdueRatePercent: input.overdueRatePercent ?? null,
          periodDays: input.rateUnit === "PERIOD" ? input.periodDays : null,
          interestTiming: "POST_PAID",
        },
      });

      await tx.scheduleLine.createMany({
        data: schedule.installments.map((installment) => ({
          loanId: loan.id,
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

      const ready = await tx.loan.update({
        where: { id: loan.id },
        data: { status: "READY_FOR_DISBURSEMENT" },
      });

      await this.audit.record(
        context,
        {
          action: "LOAN_CREATED",
          resource: "Loan",
          resourceId: loan.id,
          after: {
            loanNumber: loan.loanNumber,
            principal: principal.toMajorUnitsString(),
            ratePercent: input.ratePercent,
            rateUnit: input.rateUnit,
            termCount,
            termUnit,
            repaymentMethod: input.repaymentMethod,
            maturityDate,
          },
          metadata: {
            applicationId: application.id,
            source: "loan_slip",
            templateProductId: template?.id ?? null,
          },
        },
        tx
      );

      return ready;
    });

    return { loan: await this.getById(created.id), replayed: false };
  }

  /**
   * Invariant §74.5: a loan is disbursed exactly once, and money never leaves
   * without a durable record that it did.
   *
   * The order below is deliberate and is the whole point of this method:
   *
   *   1. Claim the loan with an atomic compare-and-set. Only one caller can
   *      move it out of APPROVED/READY_FOR_DISBURSEMENT, so a second request
   *      — even with a different idempotency key — never reaches the provider.
   *   2. Write the disbursement row as PENDING *before* calling the provider.
   *      If the process dies mid-call, the PENDING row is the evidence that a
   *      payout may be in flight and has to be reconciled. Calling first and
   *      recording afterwards can lose money silently.
   *   3. Call the provider.
   *   4. Settle the row and post the ledger entries in one transaction.
   *
   * `completedForLoanId` is a unique column set only on success, so even if
   * every check above were bypassed the database still refuses a second
   * successful disbursement for the same loan.
   */
  async disburse(
    loanId: string,
    input: { amount?: string | number; method?: string; idempotencyKey: string },
    context: AuditContext
  ) {
    if (!input.idempotencyKey) throw new ValidationError("Idempotency-Key is required to disburse");

    const existing = await this.db.disbursement.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return { disbursement: existing, loan: await this.getById(existing.loanId), replayed: true };
    }

    const loan = await this.db.loan.findUnique({ where: { id: loanId }, include: { snapshot: true } });
    if (!loan) throw new LoanNotFoundError(loanId);

    if (loan.status !== "READY_FOR_DISBURSEMENT" && loan.status !== "APPROVED") {
      throw new InvalidLoanStateError(loanId, loan.status, "DISBURSE");
    }

    const amount =
      input.amount !== undefined
        ? Money.fromMajorUnits(input.amount)
        : Money.fromMinorUnits(loan.principalCents);

    if (amount.greaterThan(Money.fromMinorUnits(loan.principalCents))) {
      throw new ValidationError("Disbursement cannot exceed the approved principal", {
        approved: Money.fromMinorUnits(loan.principalCents).toMajorUnitsString(),
        requested: amount.toMajorUnitsString(),
      });
    }

    // Checked before the claim, let alone before any money moves: a closed
    // day refuses a new disbursement outright rather than leaving one
    // half-claimed.
    await assertDayOpen(this.db, this.clock.now());

    // 1. Claim. A conditional update is atomic in a way that a read followed by
    // a write is not: whoever changes the row from the pre-disbursement status
    // wins, and every other caller sees count === 0 and stops here.
    const claimed = await this.db.loan.updateMany({
      where: { id: loanId, status: { in: ["APPROVED", "READY_FOR_DISBURSEMENT"] } },
      data: { status: "DISBURSING" },
    });
    if (claimed.count !== 1) {
      const current = await this.db.loan.findUniqueOrThrow({ where: { id: loanId } });
      throw new InvalidLoanStateError(loanId, current.status, "DISBURSE");
    }

    const occurredAt = this.clock.now();
    const sequence = (await this.db.disbursement.count()) + 1;

    // 2. Record the intent before any money can move.
    let pending;
    try {
      pending = await this.db.disbursement.create({
        data: {
          disbursementNumber: formatSequenceNumber("DSB", sequence),
          loanId,
          amountCents: amount.toMinorUnits(),
          method: input.method ?? "BANK_TRANSFER",
          status: "PENDING",
          idempotencyKey: input.idempotencyKey,
          processedBy: context.userId,
        },
      });
    } catch (error) {
      // Nothing has been sent yet, so releasing the claim is safe and leaves
      // the loan disbursable again.
      await this.releaseDisbursementClaim(loanId, loan.status as LoanStatus);
      throw error;
    }

    // 3. Send.
    //
    // Deliberately not wrapped: if this throws we do not know whether money
    // moved, so the disbursement row stays PENDING and the loan stays
    // DISBURSING. That pair is the reconciliation queue, and it is also what
    // stops anyone paying out again on top of an unresolved transfer.
    const providerResult = await this.disbursementProvider.send({
      loanNumber: loan.loanNumber,
      amount,
      method: input.method ?? "BANK_TRANSFER",
    });

    const result = await this.db.$transaction(async (tx) => {
      const disbursement = await tx.disbursement.update({
        where: { id: pending.id },
        data: {
          reference: providerResult.reference,
          status: providerResult.success ? "COMPLETED" : "FAILED",
          // Only a success takes the one slot this loan has.
          completedForLoanId: providerResult.success ? loanId : null,
          processedAt: occurredAt,
        },
      });

      if (!providerResult.success) {
        // The provider declined, so no money moved: hand the loan back.
        await tx.loan.update({ where: { id: loanId }, data: { status: loan.status } });
        return { disbursement, loanStatus: loan.status as LoanStatus };
      }

      // Money leaving is a ledger event; the balance follows from it.
      await tx.moneyEvent.create({
        data: {
          loanId,
          customerId: loan.customerId,
          type: "DISBURSEMENT",
          amountCents: amount.toMinorUnits(),
          referenceId: disbursement.id,
          occurredAt,
          createdBy: context.userId ?? "system",
          metadata: JSON.stringify({ method: disbursement.method }),
        },
      });

      // The full term's interest is recognised up front for these
      // simple-interest products: it is exactly what the schedule bills.
      const scheduleLines = await tx.scheduleLine.findMany({ where: { loanId } });
      const scheduledInterest = Money.sum(
        scheduleLines.map((l) => Money.fromMinorUnits(l.interestDueCents))
      );
      const scheduledFees = Money.sum(scheduleLines.map((l) => Money.fromMinorUnits(l.feeDueCents)));

      if (scheduledInterest.isPositive()) {
        await tx.moneyEvent.create({
          data: {
            loanId,
            customerId: loan.customerId,
            type: "INTEREST_ACCRUAL",
            amountCents: scheduledInterest.toMinorUnits(),
            referenceId: disbursement.id,
            occurredAt,
            createdBy: context.userId ?? "system",
            metadata: JSON.stringify({ basis: "scheduled-term-interest" }),
          },
        });
        await tx.interestAccrual.create({
          data: {
            loanId,
            periodStart: loan.startDate ?? occurredAt,
            periodEnd: loan.maturityDate ?? occurredAt,
            days: 0,
            amountCents: scheduledInterest.toMinorUnits(),
          },
        });
      }

      if (scheduledFees.isPositive()) {
        await tx.moneyEvent.create({
          data: {
            loanId,
            customerId: loan.customerId,
            type: "FEE_CHARGE",
            amountCents: scheduledFees.toMinorUnits(),
            referenceId: disbursement.id,
            occurredAt,
            createdBy: context.userId ?? "system",
            metadata: JSON.stringify({ basis: "scheduled-fees" }),
          },
        });
      }

      LoanStateMachine.assertTransition("DISBURSING", "DISBURSED");
      await tx.loan.update({ where: { id: loanId }, data: { status: "DISBURSED" } });

      LoanStateMachine.assertTransition("DISBURSED", "ACTIVE");
      await tx.loan.update({
        where: { id: loanId },
        data: {
          status: "ACTIVE",
          outstandingPrincipalCents: amount.toMinorUnits(),
          outstandingInterestCents: scheduledInterest.toMinorUnits(),
          outstandingFeeCents: scheduledFees.toMinorUnits(),
        },
      });

      await this.audit.record(
        context,
        {
          action: "LOAN_DISBURSED",
          resource: "Loan",
          resourceId: loanId,
          before: { status: loan.status },
          after: { status: "ACTIVE", amount: amount.toMajorUnitsString() },
          metadata: { disbursementId: disbursement.id, reference: providerResult.reference },
        },
        tx
      );

      return { disbursement, loanStatus: "ACTIVE" as LoanStatus };
    });

    return { disbursement: result.disbursement, loan: await this.getById(loanId), replayed: false };
  }

  /**
   * Hands a claimed loan back to its pre-disbursement status. Only safe to
   * call when nothing was sent to the provider — once a payout may be in
   * flight the loan must stay DISBURSING for reconciliation.
   */
  private async releaseDisbursementClaim(loanId: string, previous: LoanStatus) {
    await this.db.loan.updateMany({
      where: { id: loanId, status: "DISBURSING" },
      data: { status: previous },
    });
  }

  /**
   * Rebuilds the balance from the MoneyEvent ledger. This is the
   * reconciliation entry point from §24: stored balances are a projection
   * and must always be reproducible from events.
   */
  async recalculateLoanBalance(loanId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.db;
    const events = await client.moneyEvent.findMany({
      where: { loanId },
      orderBy: { occurredAt: "asc" },
    });

    const payments = await client.payment.findMany({
      where: { loanId },
      include: { allocations: true },
    });
    const allocationByPaymentId = new Map(
      payments.map((p) => [
        p.id,
        {
          principal: Money.fromMinorUnits(p.allocations[0]?.principalAmountCents ?? 0),
          interest: Money.fromMinorUnits(p.allocations[0]?.interestAmountCents ?? 0),
          fee: Money.fromMinorUnits(p.allocations[0]?.feeAmountCents ?? 0),
        },
      ])
    );

    const entries: LedgerEntry[] = events.map((event) => {
      const base = {
        type: event.type as LedgerEntry["type"],
        amount: Money.fromMinorUnits(event.amountCents),
      };
      if (event.type === "PAYMENT" || event.type === "PAYMENT_REVERSAL") {
        return { ...base, allocation: allocationByPaymentId.get(event.referenceId ?? "") };
      }
      return base;
    });

    return BalanceEngine.project(entries);
  }

  /** Re-evaluates delinquency against the clock and moves the loan status if needed. */
  async refreshDelinquency(loanId: string, context: AuditContext) {
    const loan = await this.db.loan.findUnique({
      where: { id: loanId },
      include: { scheduleLines: { orderBy: { installmentNumber: "asc" } } },
    });
    if (!loan) throw new LoanNotFoundError(loanId);
    if (!SERVICING.includes(loan.status)) return loan;

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

    const target = OverdueEngine.toLoanStatus(evaluation.status);
    if (target === loan.status) return loan;

    LoanStateMachine.assertTransition(loan.status as LoanStatus, target);
    const updated = await this.db.loan.update({ where: { id: loanId }, data: { status: target } });

    // Mark the individual overdue installments so the schedule tab tells the
    // truth too, not just the loan header.
    await this.db.scheduleLine.updateMany({
      where: { loanId, installmentNumber: { in: evaluation.overdueInstallments } },
      data: { status: "OVERDUE" },
    });

    void context;
    return updated;
  }

  async getById(id: string) {
    const loan = await this.db.loan.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, customerNumber: true, phone: true } },
        snapshot: true,
        scheduleLines: { orderBy: { installmentNumber: "asc" } },
        disbursements: { orderBy: { createdAt: "desc" } },
        payments: { orderBy: { paidAt: "desc" }, include: { allocations: true } },
        moneyEvents: { orderBy: { occurredAt: "asc" } },
        collectionCases: { include: { activities: true, promises: true } },
        extensions: { orderBy: { createdAt: "desc" } },
        settlement: true,
        application: { include: { riskAssessments: { orderBy: { createdAt: "desc" }, take: 1 } } },
      },
    });
    if (!loan) throw new LoanNotFoundError(id);
    return loan;
  }

  async list(params: {
    status?: string;
    customerId?: string;
    overdueOnly?: boolean;
    pendingDisbursement?: boolean;
    take?: number;
    skip?: number;
  }) {
    const where: Prisma.LoanWhereInput = {};
    if (params.status) where.status = params.status;
    if (params.customerId) where.customerId = params.customerId;
    if (params.overdueOnly) where.status = "OVERDUE";
    if (params.pendingDisbursement) where.status = { in: ["CREATED", "APPROVED", "READY_FOR_DISBURSEMENT"] };

    const [items, total] = await Promise.all([
      this.db.loan.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: params.take ?? 25,
        skip: params.skip ?? 0,
        include: {
          customer: { select: { id: true, name: true, customerNumber: true } },
          snapshot: { select: { ratePercent: true, rateUnit: true, termCount: true } },
          scheduleLines: { select: { dueDate: true, totalDueCents: true, principalPaidCents: true, interestPaidCents: true, feePaidCents: true, installmentNumber: true } },
          application: { include: { riskAssessments: { orderBy: { createdAt: "desc" }, take: 1 } } },
        },
      }),
      this.db.loan.count({ where }),
    ]);

    const now = this.clock.now();
    return {
      items: items.map((loan) => {
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
        const { scheduleLines, application, ...rest } = loan;
        void scheduleLines;
        return {
          ...rest,
          riskGrade: application?.riskAssessments[0]?.grade ?? null,
          daysOverdue: SERVICING.includes(loan.status) ? evaluation.daysOverdue : 0,
          overdueAmount: evaluation.overdueAmount.toMajorUnitsString(),
          nextDueDate: evaluation.nextDueDate,
          totalOutstanding: Money.fromMinorUnits(
            loan.outstandingPrincipalCents + loan.outstandingInterestCents + loan.outstandingFeeCents
          ).toMajorUnitsString(),
        };
      }),
      total,
    };
  }
}
