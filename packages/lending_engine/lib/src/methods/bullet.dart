import '../money.dart';
import '../schedule.dart';

/// BULLET 一次本息（見 docs/interest-rules.md §3.4）。
///
/// 還款計畫僅產生 1 期，到期日一次還本付息；期間應計利息由日結逐日累加
/// （見 docs/interest-rules.md §5），不在此計畫表另開分期項目。
ScheduleResult generateBulletSchedule(LoanTerms terms) {
  final int totalDays = terms.tenorPeriods * terms.rateSpec.periodDays;
  final r = terms.rateSpec.rateForDays(totalDays);
  final int principal = terms.principalCents;
  final int interest = roundHalfUpToCents(centsToDecimal(principal) * r);

  final item = ScheduleItem(
    periodNumber: 1,
    dueDate: terms.disbursedAt.add(Duration(days: totalDays)),
    openingBalanceCents: principal,
    principalCents: principal,
    interestCents: interest,
    closingBalanceCents: 0,
  );
  return ScheduleResult([item]);
}
