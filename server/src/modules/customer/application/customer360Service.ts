import type { PrismaClient } from "@prisma/client";
import { Money } from "../../../shared/money.js";
import { CustomerNotFoundError } from "../../../shared/errors.js";
import { OverdueEngine } from "../../loan/domain/overdueEngine.js";
import type { Clock } from "../../../shared/clock.js";
import { maskIdentityNumber } from "../../../shared/mask.js";

const SERVICING = ["ACTIVE", "DUE_SOON", "DUE", "OVERDUE", "DEFAULTED"];

/**
 * Customer360Service answers the questions in spec §75 from the underlying
 * records — nothing here is a stored summary that could drift from the
 * ledger.
 */
export class Customer360Service {
  constructor(
    private readonly db: PrismaClient,
    private readonly clock: Clock
  ) {}

  async get(customerId: string) {
    const customer = await this.db.customer.findUnique({
      where: { id: customerId },
      include: {
        applications: {
          orderBy: { createdAt: "desc" },
          include: { requestedProduct: { select: { name: true, productCode: true } } },
        },
        loans: {
          orderBy: { createdAt: "desc" },
          include: {
            scheduleLines: { orderBy: { installmentNumber: "asc" } },
            snapshot: true,
            settlement: true,
            renewalsAsOriginal: true,
            extensions: true,
          },
        },
        payments: { orderBy: { paidAt: "desc" }, include: { allocations: true } },
        riskAssessments: { orderBy: { createdAt: "desc" }, take: 10 },
        collectionCases: {
          orderBy: { createdAt: "desc" },
          include: { activities: { orderBy: { createdAt: "desc" } }, promises: true },
        },
      },
    });

    if (!customer) throw new CustomerNotFoundError(customerId);

    const now = this.clock.now();
    const activeLoans = customer.loans.filter((l) => SERVICING.includes(l.status));
    const paidOffLoans = customer.loans.filter((l) => l.status === "PAID_OFF");
    const overdueLoans = customer.loans.filter((l) => l.status === "OVERDUE");

    const outstandingPrincipal = Money.sum(
      activeLoans.map((l) => Money.fromMinorUnits(l.outstandingPrincipalCents))
    );
    const outstandingInterest = Money.sum(
      activeLoans.map((l) => Money.fromMinorUnits(l.outstandingInterestCents))
    );
    const outstandingFees = Money.sum(
      activeLoans.map((l) => Money.fromMinorUnits(l.outstandingFeeCents))
    );

    const confirmedPayments = customer.payments.filter((p) => p.status === "CONFIRMED");
    const totalRepaid = Money.sum(confirmedPayments.map((p) => Money.fromMinorUnits(p.amountCents)));
    const interestPaid = Money.sum(
      confirmedPayments.flatMap((p) => p.allocations.map((a) => Money.fromMinorUnits(a.interestAmountCents)))
    );
    const totalBorrowed = Money.sum(customer.loans.map((l) => Money.fromMinorUnits(l.principalCents)));

    // Delinquency is recomputed from each loan's schedule against the clock,
    // not read from a stored flag.
    const delinquency = customer.loans
      .filter((l) => SERVICING.includes(l.status))
      .map((loan) =>
        OverdueEngine.evaluate({
          currentDate: now,
          scheduleLines: loan.scheduleLines.map((line) => ({
            installmentNumber: line.installmentNumber,
            dueDate: line.dueDate,
            totalDue: Money.fromMinorUnits(line.totalDueCents),
            totalPaid: Money.fromMinorUnits(
              line.principalPaidCents + line.interestPaidCents + line.feePaidCents
            ),
          })),
        })
      );

    const lateEvaluations = delinquency.filter((d) => d.daysOverdue > 0);
    const averageDaysLate =
      lateEvaluations.length === 0
        ? 0
        : Math.round(
            lateEvaluations.reduce((sum, d) => sum + d.daysOverdue, 0) / lateEvaluations.length
          );

    const renewalCount = customer.loans.reduce((sum, l) => sum + l.renewalsAsOriginal.length, 0);
    const extensionCount = customer.loans.reduce((sum, l) => sum + l.extensions.length, 0);
    const latestRisk = customer.riskAssessments[0] ?? null;

    return {
      profile: {
        id: customer.id,
        customerNumber: customer.customerNumber,
        name: customer.name,
        identityNumberMasked: maskIdentityNumber(customer.identityNumber),
        dateOfBirth: customer.dateOfBirth,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        employmentStatus: customer.employmentStatus,
        employer: customer.employer,
        monthlyIncome: customer.monthlyIncomeCents
          ? Money.fromMinorUnits(customer.monthlyIncomeCents).toMajorUnitsString()
          : null,
        status: customer.status,
        createdAt: customer.createdAt,
      },
      summary: {
        totalBorrowed: totalBorrowed.toMajorUnitsString(),
        totalRepaid: totalRepaid.toMajorUnitsString(),
        interestPaid: interestPaid.toMajorUnitsString(),
        outstandingPrincipal: outstandingPrincipal.toMajorUnitsString(),
        outstandingInterest: outstandingInterest.toMajorUnitsString(),
        outstandingFees: outstandingFees.toMajorUnitsString(),
        totalOutstanding: outstandingPrincipal
          .add(outstandingInterest)
          .add(outstandingFees)
          .toMajorUnitsString(),
        activeLoanCount: activeLoans.length,
        paidOffLoanCount: paidOffLoans.length,
        overdueLoanCount: overdueLoans.length,
        overdueCount: lateEvaluations.length,
        averageDaysLate,
        renewalCount,
        extensionCount,
        currentRiskGrade: latestRisk?.grade ?? null,
        lastPaymentAt: confirmedPayments[0]?.paidAt ?? null,
        lastPaymentAmount: confirmedPayments[0]
          ? Money.fromMinorUnits(confirmedPayments[0].amountCents).toMajorUnitsString()
          : null,
      },
      applications: customer.applications.map((a) => ({
        id: a.id,
        applicationNumber: a.applicationNumber,
        status: a.status,
        requestedAmount: Money.fromMinorUnits(a.requestedAmountCents).toMajorUnitsString(),
        requestedTermCount: a.requestedTermCount,
        productName: a.requestedProduct.name,
        createdAt: a.createdAt,
      })),
      loans: customer.loans.map((l, index) => ({
        id: l.id,
        loanNumber: l.loanNumber,
        status: l.status,
        principal: Money.fromMinorUnits(l.principalCents).toMajorUnitsString(),
        outstandingPrincipal: Money.fromMinorUnits(l.outstandingPrincipalCents).toMajorUnitsString(),
        outstandingInterest: Money.fromMinorUnits(l.outstandingInterestCents).toMajorUnitsString(),
        totalOutstanding: Money.fromMinorUnits(
          l.outstandingPrincipalCents + l.outstandingInterestCents + l.outstandingFeeCents
        ).toMajorUnitsString(),
        ratePercent: l.snapshot?.ratePercent ?? null,
        rateUnit: l.snapshot?.rateUnit ?? null,
        startDate: l.startDate,
        maturityDate: l.maturityDate,
        daysOverdue: SERVICING.includes(l.status) ? (delinquency[index]?.daysOverdue ?? 0) : 0,
        settledAt: l.settlement?.settledAt ?? null,
      })),
      payments: customer.payments.map((p) => ({
        id: p.id,
        paymentNumber: p.paymentNumber,
        loanId: p.loanId,
        amount: Money.fromMinorUnits(p.amountCents).toMajorUnitsString(),
        method: p.method,
        status: p.status,
        paidAt: p.paidAt,
        allocation: p.allocations[0]
          ? {
              principal: Money.fromMinorUnits(p.allocations[0].principalAmountCents).toMajorUnitsString(),
              interest: Money.fromMinorUnits(p.allocations[0].interestAmountCents).toMajorUnitsString(),
              fee: Money.fromMinorUnits(p.allocations[0].feeAmountCents).toMajorUnitsString(),
            }
          : null,
      })),
      riskHistory: customer.riskAssessments.map((r) => ({
        id: r.id,
        score: r.score,
        grade: r.grade,
        decision: r.decision,
        reasons: JSON.parse(r.reasons) as string[],
        modelVersion: r.modelVersion,
        createdAt: r.createdAt,
      })),
      collectionCases: customer.collectionCases.map((c) => ({
        id: c.id,
        caseNumber: c.caseNumber,
        loanId: c.loanId,
        status: c.status,
        priority: c.priority,
        daysOverdue: c.daysOverdue,
        outstandingAmount: Money.fromMinorUnits(c.outstandingAmountCents).toMajorUnitsString(),
        activityCount: c.activities.length,
        promiseCount: c.promises.length,
        nextActionAt: c.nextActionAt,
      })),
    };
  }
}
