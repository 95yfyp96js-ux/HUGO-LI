import '../money.dart';
import '../schedule.dart';

/// IO 先息後本（見 docs/interest-rules.md §3.3）。
ScheduleResult generateIoSchedule(LoanTerms terms) {
  final int n = terms.tenorPeriods;
  final r = terms.rateSpec.ratePerPeriod();
  final int principal = terms.principalCents;

  final items = <ScheduleItem>[];
  for (int t = 1; t <= n; t++) {
    final int interest = roundHalfUpToCents(centsToDecimal(principal) * r);
    final int periodPrincipal = t == n ? principal : 0;
    final int closing = t == n ? 0 : principal;
    items.add(
      ScheduleItem(
        periodNumber: t,
        dueDate: terms.dueDateForPeriod(t),
        openingBalanceCents: principal,
        principalCents: periodPrincipal,
        interestCents: interest,
        closingBalanceCents: closing,
      ),
    );
  }
  return ScheduleResult(items);
}
