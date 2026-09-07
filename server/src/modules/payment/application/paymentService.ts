import type { Prisma, PrismaClient } from "@prisma/client";
import { Money } from "../../../shared/money.js";
import {
  InvalidLoanStateError,
  InvalidPaymentError,
  LoanNotFoundError,
  ValidationError,
  isUniqueConstraintViolation,
} from "../../../shared/errors.js";
import { formatSequenceNumber } from "../../../shared/ids.js";
import type { Clock } from "../../../shared/clock.js";
import type { AuditContext, AuditService } from "../../audit/application/auditService.js";
import { AllocationEngine } from "../domain/allocationEngine.js";
import { LoanStateMachine, type LoanStatus } from "../../loan/domain/loanStateMachine.js";
import { OverdueEngine } from "../../loan/domain/overdueEngine.js";
import { CollectionEngine } from "../../collection/domain/collectionEngine.js";
import {
  SettlementPolicyEngine,
  type SettlementPolicy,
} from "../../repayment/domain/settlementPolicy.js";
import { SettlementPolicyNotImplementedError } from "../../../shared/errors.js";

const SERVICING = ["ACTIVE", "DUE_SOON", "DUE", "OVERDUE", "DEFAULTED"];

export interface CreatePaymentInput {
  loanId: string;
  amount: string | number;
  method?: string;
  paidAt?: string;
  idempotencyKey: string;
}

export class PaymentService {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditService,
    private readonly clock: Clock
  ) {}

  /** What the borrower owes right now, split into the allocation buckets. */
  async getOutstanding(loanId: string) {
    const loan = await this.db.loan.findUnique({ where: { id: loanId } });
    if (!loan) throw new LoanNotFoundError(loanId);
    return {
      interest: Money.fromMinorUnits(loan.outstandingInterestCents),
      fees: Money.fromMinorUnits(loan.outstandingFeeCents),
      principal: Money.fromMinorUnits(loan.outstandingPrincipalCents),
    };
  }

  /**
   * What it costs to close this loan today, under the settlement policy
   * frozen onto its snapshot.
   *
   * The policy is read from the loan's own snapshot, never from the current
   * product, so repricing a product cannot change an existing borrower's
   * payoff terms.
   */
  async settlementQuote(loanId: string) {
    const loan = await this.db.loan.findUnique({
      where: { id: loanId },
      include: { snapshot: true, scheduleLines: { orderBy: { installmentNumber: "asc" } } },
    });
    if (!loan) throw new LoanNotFoundError(loanId);

    const policy = (loan.snapshot?.settlementPolicy ?? "FULL_CONTRACT_INTEREST") as SettlementPolicy;

    const quote = SettlementPolicyEngine.quote({
      policy,
      settlementDate: this.clock.now(),
      outstandingPrincipal: Money.fromMinorUnits(loan.outstandingPrincipalCents),
      outstandingInterest: Money.fromMinorUnits(loan.outstandingInterestCents),
      outstandingFees: Money.fromMinorUnits(loan.outstandingFeeCents),
      scheduleLines: loan.scheduleLines.map((line) => ({
        installmentNumber: line.installmentNumber,
        dueDate: line.dueDate,
        interestDue: Money.fromMinorUnits(line.interestDueCents),
      })),
    });

    return {
      loanId,
      policy,
      earnedInterest: quote.earnedInterest.toMajorUnitsString(),
      unearnedInterest: quote.unearnedInterest.toMajorUnitsString(),
      rebate: quote.rebate.toMajorUnitsString(),
      interestPayable: quote.interestPayable.toMajorUnitsString(),
      payoffAmount: quote.payoffAmount.toMajorUnitsString(),
      /**
       * v1 recognises the whole term's interest at disbursement, so waiving
       * the unearned portion needs a ledger change that is out of scope for
       * this sprint. Rebate loans therefore quote correctly but cannot be
       * settled through the API yet.
       */
      settleable: quote.rebate.isZero(),
    };
  }

  /** Guards the settle path against silently overcharging a rebate borrower. */
  async assertSettleable(loanId: string): Promise<void> {
    const quote = await this.settlementQuote(loanId);
    if (!quote.settleable) {
      throw new SettlementPolicyNotImplementedError(quote.policy, loanId);
    }
  }

  /** Preview of how a payment would be split — used by the collection UI before confirming. */
  async previewAllocation(loanId: string, amount: string | number) {
    const outstanding = await this.getOutstanding(loanId);
    const allocation = AllocationEngine.allocate(Money.fromMajorUnits(amount), outstanding);
    return {
      outstanding: {
        principal: outstanding.principal.toMajorUnitsString(),
        interest: outstanding.interest.toMajorUnitsString(),
        fees: outstanding.fees.toMajorUnitsString(),
        total: outstanding.principal
          .add(outstanding.interest)
          .add(outstanding.fees)
          .toMajorUnitsString(),
      },
      allocation: {
        interest: allocation.interestAmount.toMajorUnitsString(),
        fee: allocation.feeAmount.toMajorUnitsString(),
        principal: allocation.principalAmount.toMajorUnitsString(),
        unallocated: allocation.unallocated.toMajorUnitsString(),
      },
    };
  }

  /**
   * Records a payment. Everything — payment row, allocation, ledger event,
   * schedule update, balance, loan status, settlement, collection case — is
   * written in one transaction (§48). Idempotency is enforced by a unique
   * column, so a retried request cannot create a second payment (§63).
   */
  async create(input: CreatePaymentInput, context: AuditContext) {
    if (!input.idempotencyKey) {
      throw new ValidationError("Idempotency-Key is required to create a payment");
    }

    const existing = await this.db.payment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { allocations: true },
    });
    if (existing) return { payment: existing, replayed: true };

    const amount = Money.fromMajorUnits(input.amount);
    if (!amount.isPositive()) throw new InvalidPaymentError("Payment amount must be positive");

    const loan = await this.loadLoanForPayment(input.loanId);

    // Invariant §74.14: a settled loan does not keep taking money.
    if (!SERVICING.includes(loan.status)) {
      throw new InvalidLoanStateError(loan.id, loan.status, "PAYMENT");
    }

    const outstanding = {
      interest: Money.fromMinorUnits(loan.outstandingInterestCents),
      fees: Money.fromMinorUnits(loan.outstandingFeeCents),
      principal: Money.fromMinorUnits(loan.outstandingPrincipalCents),
    };
    const totalOutstanding = outstanding.interest.add(outstanding.fees).add(outstanding.principal);

    if (amount.greaterThan(totalOutstanding)) {
      throw new InvalidPaymentError("Payment exceeds the total outstanding balance", {
        amount: amount.toMajorUnitsString(),
        totalOutstanding: totalOutstanding.toMajorUnitsString(),
      });
    }

    const allocation = AllocationEngine.allocate(amount, outstanding);
    const paidAt = input.paidAt ? new Date(input.paidAt) : this.clock.now();
    const sequence = (await this.db.payment.count()) + 1;

    const payment = await this.runCreateTransaction({
      loan,
      amount,
      allocation,
      paidAt,
      sequence,
      input,
      context,
    });

    return { payment, replayed: false };
  }

  private async loadLoanForPayment(loanId: string) {
    const loan = await this.db.loan.findUnique({
      where: { id: loanId },
      include: { scheduleLines: { orderBy: { installmentNumber: "asc" } }, collectionCases: true },
    });
    if (!loan) throw new LoanNotFoundError(loanId);
    return loan;
  }

  /**
   * The write half of `create`, split out so a lost idempotency race can be
   * answered with the winner's payment instead of a constraint error.
   *
   * The lookup in `create` is a fast path, not the guarantee: between that
   * read and this write a concurrent request with the same key can commit
   * first. `Payment.idempotencyKey` is unique, so the loser fails with P2002
   * — one payment, one set of ledger entries — and the correct response is
   * the payment that did get written, which is exactly what a retry asked for.
   */
  private async runCreateTransaction(args: {
    loan: Awaited<ReturnType<PaymentService["loadLoanForPayment"]>>;
    amount: Money;
    allocation: ReturnType<typeof AllocationEngine.allocate>;
    paidAt: Date;
    sequence: number;
    input: CreatePaymentInput;
    context: AuditContext;
  }) {
    const { loan, amount, allocation, paidAt, sequence, input, context } = args;
    try {
      return await this.writePayment(loan, amount, allocation, paidAt, sequence, input, context);
    } catch (error) {
      if (isUniqueConstraintViolation(error, "idempotencyKey")) {
        const winner = await this.db.payment.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: { allocations: true },
        });
        if (winner) return winner;
      }
      throw error;
    }
  }

  private async writePayment(
    loan: Awaited<ReturnType<PaymentService["loadLoanForPayment"]>>,
    amount: Money,
    allocation: ReturnType<typeof AllocationEngine.allocate>,
    paidAt: Date,
    sequence: number,
    input: CreatePaymentInput,
    context: AuditContext
  ) {
    const outstanding = {
      interest: Money.fromMinorUnits(loan.outstandingInterestCents),
      fees: Money.fromMinorUnits(loan.outstandingFeeCents),
      principal: Money.fromMinorUnits(loan.outstandingPrincipalCents),
    };

    return await this.db.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          paymentNumber: formatSequenceNumber("PMT", sequence),
          loanId: loan.id,
          customerId: loan.customerId,
          amountCents: amount.toMinorUnits(),
          method: input.method ?? "CASH",
          status: "CONFIRMED",
          idempotencyKey: input.idempotencyKey,
          paidAt,
          createdBy: context.userId ?? "system",
          allocations: {
            create: {
              principalAmountCents: allocation.principalAmount.toMinorUnits(),
              interestAmountCents: allocation.interestAmount.toMinorUnits(),
              feeAmountCents: allocation.feeAmount.toMinorUnits(),
            },
          },
        },
        include: { allocations: true },
      });

      await tx.moneyEvent.create({
        data: {
          loanId: loan.id,
          customerId: loan.customerId,
          type: "PAYMENT",
          amountCents: amount.toMinorUnits(),
          referenceId: created.id,
          occurredAt: paidAt,
          createdBy: context.userId ?? "system",
          metadata: JSON.stringify({ method: created.method }),
        },
      });

      await this.applyToSchedule(tx, loan.id, allocation);

      const newBalance = {
        principal: outstanding.principal.subtract(allocation.principalAmount),
        interest: outstanding.interest.subtract(allocation.interestAmount),
        fees: outstanding.fees.subtract(allocation.feeAmount),
      };
      const remaining = newBalance.principal.add(newBalance.interest).add(newBalance.fees);

      await tx.loan.update({
        where: { id: loan.id },
        data: {
          outstandingPrincipalCents: newBalance.principal.toMinorUnits(),
          outstandingInterestCents: newBalance.interest.toMinorUnits(),
          outstandingFeeCents: newBalance.fees.toMinorUnits(),
        },
      });

      if (remaining.isZero()) {
        await this.settleLoan(tx, loan.id, loan.customerId, paidAt, context);
      } else {
        await this.refreshStatus(tx, loan.id, loan.status as LoanStatus);
      }

      await this.syncCollectionCases(tx, loan.id, remaining);

      await this.audit.record(
        context,
        {
          action: "PAYMENT_CREATED",
          resource: "Payment",
          resourceId: created.id,
          after: {
            paymentNumber: created.paymentNumber,
            amount: amount.toMajorUnitsString(),
            allocation: {
              principal: allocation.principalAmount.toMajorUnitsString(),
              interest: allocation.interestAmount.toMajorUnitsString(),
              fee: allocation.feeAmount.toMajorUnitsString(),
            },
            remainingOutstanding: remaining.toMajorUnitsString(),
          },
          metadata: { loanId: loan.id },
        },
        tx
      );

      return created;
    });
  }

  /**
   * Invariant §74.12: reversing does not delete anything. It writes a
   * PAYMENT_REVERSAL event and restores the balance.
   */
  async reverse(paymentId: string, reason: string, context: AuditContext) {
    if (!reason?.trim()) throw new ValidationError("A reversal reason is required");

    const payment = await this.db.payment.findUnique({
      where: { id: paymentId },
      include: { allocations: true, loan: true },
    });
    if (!payment) throw new InvalidPaymentError("Payment not found", { paymentId });
    // Only a confirmed payment moved money, so only a confirmed payment has
    // anything to compensate. This is the friendly error; the compare-and-set
    // below is the guarantee.
    if (payment.status !== "CONFIRMED") {
      throw new InvalidPaymentError(
        payment.status === "REVERSED"
          ? "Payment has already been reversed"
          : "Only a confirmed payment can be reversed",
        { paymentId, status: payment.status }
      );
    }

    const allocation = payment.allocations[0];
    if (!allocation) throw new InvalidPaymentError("Payment has no allocation to reverse", { paymentId });

    const occurredAt = this.clock.now();

    const reversed = await this.db.$transaction(async (tx) => {
      // Compare-and-set, not update-by-id. The status was read outside this
      // transaction, so by now another reversal may already have run: an
      // unconditional update would credit the borrower's balance back twice
      // and post two compensating ledger entries for one payment. Only the
      // caller that actually moves the row from CONFIRMED proceeds.
      const claimed = await tx.payment.updateMany({
        where: { id: paymentId, status: "CONFIRMED" },
        data: { status: "REVERSED" },
      });
      if (claimed.count !== 1) {
        throw new InvalidPaymentError("Payment is no longer reversible", { paymentId });
      }
      const updated = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });

      await tx.moneyEvent.create({
        data: {
          loanId: payment.loanId,
          customerId: payment.customerId,
          type: "PAYMENT_REVERSAL",
          amountCents: payment.amountCents,
          referenceId: payment.id,
          occurredAt,
          createdBy: context.userId ?? "system",
          metadata: JSON.stringify({ reason }),
        },
      });

      // Put the money back where it came from, bucket by bucket.
      await tx.loan.update({
        where: { id: payment.loanId },
        data: {
          outstandingPrincipalCents: { increment: allocation.principalAmountCents },
          outstandingInterestCents: { increment: allocation.interestAmountCents },
          outstandingFeeCents: { increment: allocation.feeAmountCents },
        },
      });

      await this.unapplyFromSchedule(tx, payment.loanId, allocation);

      const loan = await tx.loan.findUniqueOrThrow({ where: { id: payment.loanId } });
      // A reversal can un-settle a loan that was paid off in error.
      if (loan.status === "PAID_OFF") {
        await tx.settlement.deleteMany({ where: { loanId: loan.id } });
        await tx.loan.update({ where: { id: loan.id }, data: { status: "ACTIVE" } });
        await this.refreshStatus(tx, loan.id, "ACTIVE");
      } else {
        await this.refreshStatus(tx, loan.id, loan.status as LoanStatus);
      }

      await this.audit.record(
        context,
        {
          action: "PAYMENT_REVERSED",
          resource: "Payment",
          resourceId: paymentId,
          before: { status: payment.status },
          after: { status: "REVERSED" },
          reason,
          metadata: { loanId: payment.loanId },
        },
        tx
      );

      return updated;
    });

    return reversed;
  }

  /**
   * Installments due on a given calendar day that are not yet fully
   * collected — the receivables list a collector or officer works from.
   *
   * Filtered by ScheduleLine.dueDate, compared as a whole UTC day (the same
   * convention OverdueEngine uses), not a range: picking a different day
   * shows only that day's installments, never a running total since then.
   * "狀態" (今天到期 / 已逾期) is judged against the real current date from the
   * injected Clock, independent of which day is being viewed — a line for
   * yesterday is 已逾期 whichever day you are looking at it from.
   */
  async dueOn(dateInput?: string) {
    const reference = dateInput ? new Date(`${dateInput}T00:00:00.000Z`) : this.clock.now();
    if (Number.isNaN(reference.getTime())) {
      throw new ValidationError("date must be a valid calendar date (YYYY-MM-DD)", { date: dateInput });
    }
    const dayStart = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate());
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;

    const lines = await this.db.scheduleLine.findMany({
      where: { dueDate: { gte: new Date(dayStart), lt: new Date(dayEnd) } },
      orderBy: [{ dueDate: "asc" }, { installmentNumber: "asc" }],
      include: {
        loan: {
          select: {
            id: true,
            loanNumber: true,
            customer: { select: { id: true, name: true, customerNumber: true } },
          },
        },
      },
    });

    const today = this.clock.now();
    const todayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

    const items = lines
      .map((line) => {
        const totalDue = Money.fromMinorUnits(line.totalDueCents);
        const totalPaid = Money.fromMinorUnits(
          line.principalPaidCents + line.interestPaidCents + line.feePaidCents
        );
        const remaining = totalDue.subtract(totalPaid);
        return { line, totalDue, totalPaid, remaining };
      })
      // "尚未收滿": a line already fully paid is not a receivable, even if it
      // fell due today.
      .filter(({ remaining }) => remaining.isPositive())
      .map(({ line, totalDue, totalPaid, remaining }) => ({
        loanId: line.loan.id,
        loanNumber: line.loan.loanNumber,
        customerId: line.loan.customer.id,
        customerName: line.loan.customer.name,
        customerNumber: line.loan.customer.customerNumber,
        installmentNumber: line.installmentNumber,
        dueDate: line.dueDate,
        totalDue: totalDue.toMajorUnitsString(),
        totalPaid: totalPaid.toMajorUnitsString(),
        remaining: remaining.toMajorUnitsString(),
        status: Date.UTC(line.dueDate.getUTCFullYear(), line.dueDate.getUTCMonth(), line.dueDate.getUTCDate()) < todayStart
          ? ("OVERDUE" as const)
          : ("DUE_TODAY" as const),
      }));

    return {
      date: new Date(dayStart).toISOString().slice(0, 10),
      items,
      totalRemaining: Money.sum(items.map((i) => Money.fromMajorUnits(i.remaining))).toMajorUnitsString(),
    };
  }

  async list(params: { loanId?: string; customerId?: string; take?: number; skip?: number }) {
    const where: Prisma.PaymentWhereInput = {};
    if (params.loanId) where.loanId = params.loanId;
    if (params.customerId) where.customerId = params.customerId;

    const [items, total] = await Promise.all([
      this.db.payment.findMany({
        where,
        orderBy: { paidAt: "desc" },
        take: params.take ?? 25,
        skip: params.skip ?? 0,
        include: {
          allocations: true,
          loan: { select: { id: true, loanNumber: true } },
          customer: { select: { id: true, name: true, customerNumber: true } },
        },
      }),
      this.db.payment.count({ where }),
    ]);
    return { items, total };
  }

  /** Applies an allocation across unpaid installments, oldest first. */
  private async applyToSchedule(
    tx: Prisma.TransactionClient,
    loanId: string,
    allocation: { interestAmount: Money; feeAmount: Money; principalAmount: Money }
  ) {
    const lines = await tx.scheduleLine.findMany({
      where: { loanId },
      orderBy: { installmentNumber: "asc" },
    });

    let interest = allocation.interestAmount;
    let fee = allocation.feeAmount;
    let principal = allocation.principalAmount;

    for (const line of lines) {
      if (interest.isZero() && fee.isZero() && principal.isZero()) break;

      const interestOwed = Money.fromMinorUnits(line.interestDueCents - line.interestPaidCents);
      const feeOwed = Money.fromMinorUnits(line.feeDueCents - line.feePaidCents);
      const principalOwed = Money.fromMinorUnits(line.principalDueCents - line.principalPaidCents);

      const interestPay = Money.min(interest, interestOwed);
      const feePay = Money.min(fee, feeOwed);
      const principalPay = Money.min(principal, principalOwed);

      if (interestPay.isZero() && feePay.isZero() && principalPay.isZero()) continue;

      interest = interest.subtract(interestPay);
      fee = fee.subtract(feePay);
      principal = principal.subtract(principalPay);

      const interestPaid = line.interestPaidCents + interestPay.toMinorUnits();
      const feePaid = line.feePaidCents + feePay.toMinorUnits();
      const principalPaid = line.principalPaidCents + principalPay.toMinorUnits();
      const fullyPaid =
        interestPaid >= line.interestDueCents &&
        feePaid >= line.feeDueCents &&
        principalPaid >= line.principalDueCents;

      await tx.scheduleLine.update({
        where: { id: line.id },
        data: {
          interestPaidCents: interestPaid,
          feePaidCents: feePaid,
          principalPaidCents: principalPaid,
          status: fullyPaid ? "PAID" : "PARTIALLY_PAID",
        },
      });
    }
  }

  /** Reverses schedule application, newest paid installment first. */
  private async unapplyFromSchedule(
    tx: Prisma.TransactionClient,
    loanId: string,
    allocation: { principalAmountCents: number; interestAmountCents: number; feeAmountCents: number }
  ) {
    const lines = await tx.scheduleLine.findMany({
      where: { loanId },
      orderBy: { installmentNumber: "desc" },
    });

    let interest = allocation.interestAmountCents;
    let fee = allocation.feeAmountCents;
    let principal = allocation.principalAmountCents;

    for (const line of lines) {
      if (interest === 0 && fee === 0 && principal === 0) break;

      const interestBack = Math.min(interest, line.interestPaidCents);
      const feeBack = Math.min(fee, line.feePaidCents);
      const principalBack = Math.min(principal, line.principalPaidCents);
      if (interestBack === 0 && feeBack === 0 && principalBack === 0) continue;

      interest -= interestBack;
      fee -= feeBack;
      principal -= principalBack;

      const interestPaid = line.interestPaidCents - interestBack;
      const feePaid = line.feePaidCents - feeBack;
      const principalPaid = line.principalPaidCents - principalBack;
      const anyPaid = interestPaid > 0 || feePaid > 0 || principalPaid > 0;

      await tx.scheduleLine.update({
        where: { id: line.id },
        data: {
          interestPaidCents: interestPaid,
          feePaidCents: feePaid,
          principalPaidCents: principalPaid,
          status: anyPaid ? "PARTIALLY_PAID" : "PENDING",
        },
      });
    }
  }

  private async settleLoan(
    tx: Prisma.TransactionClient,
    loanId: string,
    customerId: string,
    settledAt: Date,
    context: AuditContext
  ) {
    const payments = await tx.payment.findMany({
      where: { loanId, status: "CONFIRMED" },
      include: { allocations: true },
    });

    const principalPaid = payments.reduce((s, p) => s + (p.allocations[0]?.principalAmountCents ?? 0), 0);
    const interestPaid = payments.reduce((s, p) => s + (p.allocations[0]?.interestAmountCents ?? 0), 0);
    const feesPaid = payments.reduce((s, p) => s + (p.allocations[0]?.feeAmountCents ?? 0), 0);

    const loan = await tx.loan.findUniqueOrThrow({ where: { id: loanId } });
    LoanStateMachine.assertTransition(loan.status as LoanStatus, "PAID_OFF");

    await tx.loan.update({ where: { id: loanId }, data: { status: "PAID_OFF" } });

    await tx.settlement.create({
      data: {
        loanId,
        principalPaidCents: principalPaid,
        interestPaidCents: interestPaid,
        feesPaidCents: feesPaid,
        totalPaidCents: principalPaid + interestPaid + feesPaid,
        settledAt,
        settledBy: context.userId ?? "system",
      },
    });

    await tx.moneyEvent.create({
      data: {
        loanId,
        customerId,
        type: "SETTLEMENT",
        amountCents: 0,
        occurredAt: settledAt,
        createdBy: context.userId ?? "system",
        metadata: JSON.stringify({ basis: "balance-reached-zero" }),
      },
    });

    await this.audit.record(
      context,
      {
        action: "SETTLEMENT_CREATED",
        resource: "Loan",
        resourceId: loanId,
        after: { status: "PAID_OFF", totalPaid: principalPaid + interestPaid + feesPaid },
      },
      tx
    );
  }

  /** Re-derives delinquency status inside the payment transaction. */
  private async refreshStatus(tx: Prisma.TransactionClient, loanId: string, currentStatus: LoanStatus) {
    if (!SERVICING.includes(currentStatus)) return;

    const lines = await tx.scheduleLine.findMany({ where: { loanId } });
    const evaluation = OverdueEngine.evaluate({
      currentDate: this.clock.now(),
      scheduleLines: lines.map((line) => ({
        installmentNumber: line.installmentNumber,
        dueDate: line.dueDate,
        totalDue: Money.fromMinorUnits(line.totalDueCents),
        totalPaid: Money.fromMinorUnits(
          line.principalPaidCents + line.interestPaidCents + line.feePaidCents
        ),
      })),
    });

    const target = OverdueEngine.toLoanStatus(evaluation.status);
    if (target !== currentStatus) {
      LoanStateMachine.assertTransition(currentStatus, target);
      await tx.loan.update({ where: { id: loanId }, data: { status: target } });
    }
  }

  private async syncCollectionCases(tx: Prisma.TransactionClient, loanId: string, remaining: Money) {
    const openCases = await tx.collectionCase.findMany({
      where: { loanId, status: { notIn: ["CLOSED", "PAID"] } },
    });

    for (const collectionCase of openCases) {
      const nextStatus = CollectionEngine.resolveStatusAfterPayment(
        remaining,
        collectionCase.status as "OPEN" | "IN_PROGRESS" | "PROMISE_TO_PAY" | "ESCALATED" | "PAID" | "CLOSED"
      );
      await tx.collectionCase.update({
        where: { id: collectionCase.id },
        data: { status: nextStatus, outstandingAmountCents: remaining.toMinorUnits() },
      });
    }
  }
}
