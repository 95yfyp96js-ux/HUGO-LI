import type { PrismaClient } from "@prisma/client";
import { Money } from "../../../shared/money.js";
import type { Clock } from "../../../shared/clock.js";
import { OverdueEngine } from "../../loan/domain/overdueEngine.js";

const SERVICING = ["ACTIVE", "DUE_SOON", "DUE", "OVERDUE", "DEFAULTED"];

/**
 * PortfolioService computes every KPI from underlying records. Nothing here
 * is a stored aggregate, so no number can drift from the loans and payments
 * that produced it (§32/§41: every KPI must drill down to real rows).
 */
export class PortfolioService {
  constructor(
    private readonly db: PrismaClient,
    private readonly clock: Clock
  ) {}

  async summary() {
    const now = this.clock.now();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [loans, disbursements, payments] = await Promise.all([
      this.db.loan.findMany({
        include: { scheduleLines: { orderBy: { installmentNumber: "asc" } } },
      }),
      this.db.disbursement.findMany({ where: { status: "COMPLETED" } }),
      this.db.payment.findMany({ where: { status: "CONFIRMED" } }),
    ]);

    const activeLoans = loans.filter((l) => SERVICING.includes(l.status));

    const outstandingPrincipal = Money.sum(
      activeLoans.map((l) => Money.fromMinorUnits(l.outstandingPrincipalCents))
    );
    const outstandingInterest = Money.sum(
      activeLoans.map((l) => Money.fromMinorUnits(l.outstandingInterestCents))
    );
    const outstandingFees = Money.sum(
      activeLoans.map((l) => Money.fromMinorUnits(l.outstandingFeeCents))
    );

    // Delinquency is recomputed per loan from its schedule and the clock.
    let overduePrincipal = Money.zero();
    let overdueLoanCount = 0;
    let dueTodayAmount = Money.zero();
    let dueTodayCount = 0;
    let totalDaysLate = 0;
    let lateLoanCount = 0;

    const parBuckets = { par7: Money.zero(), par30: Money.zero(), par60: Money.zero(), par90: Money.zero() };

    for (const loan of activeLoans) {
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

      const loanOutstanding = Money.fromMinorUnits(
        loan.outstandingPrincipalCents + loan.outstandingInterestCents + loan.outstandingFeeCents
      );

      if (evaluation.daysOverdue > 0) {
        overdueLoanCount += 1;
        overduePrincipal = overduePrincipal.add(
          Money.fromMinorUnits(loan.outstandingPrincipalCents)
        );
        totalDaysLate += evaluation.daysOverdue;
        lateLoanCount += 1;

        // PAR-N = outstanding balance of loans more than N days late.
        if (evaluation.daysOverdue > 7) parBuckets.par7 = parBuckets.par7.add(loanOutstanding);
        if (evaluation.daysOverdue > 30) parBuckets.par30 = parBuckets.par30.add(loanOutstanding);
        if (evaluation.daysOverdue > 60) parBuckets.par60 = parBuckets.par60.add(loanOutstanding);
        if (evaluation.daysOverdue > 90) parBuckets.par90 = parBuckets.par90.add(loanOutstanding);
      }

      if (evaluation.status === "DUE") {
        dueTodayCount += 1;
        dueTodayAmount = dueTodayAmount.add(evaluation.overdueAmount);
        const todayLine = loan.scheduleLines.find(
          (line) => line.dueDate >= startOfToday && line.dueDate <= endOfToday
        );
        if (todayLine) {
          dueTodayAmount = dueTodayAmount.add(
            Money.fromMinorUnits(
              todayLine.totalDueCents -
                (todayLine.principalPaidCents + todayLine.interestPaidCents + todayLine.feePaidCents)
            )
          );
        }
      }
    }

    const totalPortfolio = outstandingPrincipal.add(outstandingInterest).add(outstandingFees);
    const parRatio = (bucket: Money) =>
      totalPortfolio.isZero()
        ? "0.00"
        : ((bucket.toMajorUnitsNumber() / totalPortfolio.toMajorUnitsNumber()) * 100).toFixed(2);

    const inRange = <T extends { createdAt?: Date; paidAt?: Date; processedAt?: Date | null }>(
      items: T[],
      field: (item: T) => Date | null | undefined,
      from: Date,
      to?: Date
    ) =>
      items.filter((item) => {
        const value = field(item);
        if (!value) return false;
        return value >= from && (!to || value <= to);
      });

    const todayDisbursements = inRange(disbursements, (d) => d.processedAt, startOfToday, endOfToday);
    const monthDisbursements = inRange(disbursements, (d) => d.processedAt, startOfMonth);
    const todayPayments = inRange(payments, (p) => p.paidAt, startOfToday, endOfToday);
    const monthPayments = inRange(payments, (p) => p.paidAt, startOfMonth);

    const totalDisbursed = Money.sum(disbursements.map((d) => Money.fromMinorUnits(d.amountCents)));
    const totalCollected = Money.sum(payments.map((p) => Money.fromMinorUnits(p.amountCents)));

    const pendingDisbursementCount = loans.filter((l) =>
      ["CREATED", "APPROVED", "READY_FOR_DISBURSEMENT"].includes(l.status)
    ).length;

    const pendingApprovalCount = await this.db.lendingApplication.count({
      where: { status: { in: ["SUBMITTED", "UNDER_REVIEW", "RISK_REVIEW"] } },
    });

    const averageLoanSize = activeLoans.length
      ? Money.sum(activeLoans.map((l) => Money.fromMinorUnits(l.principalCents))).multiply(
          1 / activeLoans.length
        )
      : Money.zero();

    return {
      outstandingPrincipal: outstandingPrincipal.toMajorUnitsString(),
      outstandingInterest: outstandingInterest.toMajorUnitsString(),
      outstandingFees: outstandingFees.toMajorUnitsString(),
      totalOutstanding: totalPortfolio.toMajorUnitsString(),
      activeLoanCount: activeLoans.length,
      totalLoanCount: loans.length,
      paidOffLoanCount: loans.filter((l) => l.status === "PAID_OFF").length,
      overdueLoanCount,
      overduePrincipal: overduePrincipal.toMajorUnitsString(),
      dueTodayCount,
      dueTodayAmount: dueTodayAmount.toMajorUnitsString(),
      pendingApprovalCount,
      pendingDisbursementCount,
      todayDisbursement: Money.sum(
        todayDisbursements.map((d) => Money.fromMinorUnits(d.amountCents))
      ).toMajorUnitsString(),
      todayCollection: Money.sum(
        todayPayments.map((p) => Money.fromMinorUnits(p.amountCents))
      ).toMajorUnitsString(),
      monthDisbursement: Money.sum(
        monthDisbursements.map((d) => Money.fromMinorUnits(d.amountCents))
      ).toMajorUnitsString(),
      monthCollection: Money.sum(
        monthPayments.map((p) => Money.fromMinorUnits(p.amountCents))
      ).toMajorUnitsString(),
      totalDisbursed: totalDisbursed.toMajorUnitsString(),
      totalCollected: totalCollected.toMajorUnitsString(),
      averageLoanSize: averageLoanSize.toMajorUnitsString(),
      averageDaysLate: lateLoanCount === 0 ? 0 : Math.round(totalDaysLate / lateLoanCount),
      par: {
        par7: parBuckets.par7.toMajorUnitsString(),
        par30: parBuckets.par30.toMajorUnitsString(),
        par60: parBuckets.par60.toMajorUnitsString(),
        par90: parBuckets.par90.toMajorUnitsString(),
        par7Ratio: parRatio(parBuckets.par7),
        par30Ratio: parRatio(parBuckets.par30),
        par60Ratio: parRatio(parBuckets.par60),
        par90Ratio: parRatio(parBuckets.par90),
      },
      // Collection rate = cash collected against everything ever advanced.
      collectionRate: totalDisbursed.isZero()
        ? "0.00"
        : ((totalCollected.toMajorUnitsNumber() / totalDisbursed.toMajorUnitsNumber()) * 100).toFixed(2),
    };
  }

  /** Portfolio split by risk grade, for the dashboard drill-down. */
  async byRiskGrade() {
    const loans = await this.db.loan.findMany({
      where: { status: { in: SERVICING } },
      include: {
        application: { include: { riskAssessments: { orderBy: { createdAt: "desc" }, take: 1 } } },
      },
    });

    const buckets = new Map<string, { count: number; outstanding: Money }>();
    for (const loan of loans) {
      const grade = loan.application?.riskAssessments[0]?.grade ?? "UNGRADED";
      const current = buckets.get(grade) ?? { count: 0, outstanding: Money.zero() };
      buckets.set(grade, {
        count: current.count + 1,
        outstanding: current.outstanding.add(
          Money.fromMinorUnits(
            loan.outstandingPrincipalCents + loan.outstandingInterestCents + loan.outstandingFeeCents
          )
        ),
      });
    }

    return [...buckets.entries()]
      .map(([grade, value]) => ({
        grade,
        loanCount: value.count,
        outstanding: value.outstanding.toMajorUnitsString(),
      }))
      .sort((a, b) => a.grade.localeCompare(b.grade));
  }

  /** Disbursement vs collection over the last N days, for trend charts. */
  async trend(days = 30) {
    const now = this.clock.now();
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    from.setHours(0, 0, 0, 0);

    const [disbursements, payments] = await Promise.all([
      this.db.disbursement.findMany({
        where: { status: "COMPLETED", processedAt: { gte: from } },
        select: { amountCents: true, processedAt: true },
      }),
      this.db.payment.findMany({
        where: { status: "CONFIRMED", paidAt: { gte: from } },
        select: { amountCents: true, paidAt: true },
      }),
    ]);

    const series = new Map<string, { disbursed: Money; collected: Money }>();
    for (let i = 0; i <= days; i++) {
      const day = new Date(from.getTime() + i * 24 * 60 * 60 * 1000);
      series.set(day.toISOString().slice(0, 10), { disbursed: Money.zero(), collected: Money.zero() });
    }

    for (const d of disbursements) {
      if (!d.processedAt) continue;
      const key = d.processedAt.toISOString().slice(0, 10);
      const entry = series.get(key);
      if (entry) entry.disbursed = entry.disbursed.add(Money.fromMinorUnits(d.amountCents));
    }
    for (const p of payments) {
      const key = p.paidAt.toISOString().slice(0, 10);
      const entry = series.get(key);
      if (entry) entry.collected = entry.collected.add(Money.fromMinorUnits(p.amountCents));
    }

    return [...series.entries()].map(([date, value]) => ({
      date,
      disbursed: value.disbursed.toMajorUnitsString(),
      collected: value.collected.toMajorUnitsString(),
    }));
  }
}
