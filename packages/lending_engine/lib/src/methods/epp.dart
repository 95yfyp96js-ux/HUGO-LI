import '../money.dart';
import '../schedule.dart';

/// EPP 等額本金（見 docs/interest-rules.md §3.2）。
ScheduleResult generateEppSchedule(LoanTerms terms) {
  final int n = terms.tenorPeriods;
  final r = terms.rateSpec.ratePerPeriod();
  final int basePrincipal = terms.principalCents ~/ n;

  final items = <ScheduleItem>[];
  int balance = terms.principalCents;
  for (int t = 1; t <= n; t++) {
    final int opening = balance;
    final int principal = t == n
        ? opening // 末期吃尾差。
        : basePrincipal;
    final int interest = roundHalfUpToCents(centsToDecimal(opening) * r);
    balance = opening - principal;
    items.add(
      ScheduleItem(
        periodNumber: t,
        dueDate: terms.dueDateForPeriod(t),
        openingBalanceCents: opening,
        principalCents: principal,
        interestCents: interest,
        closingBalanceCents: balance,
      ),
    );
  }
  return ScheduleResult(items);
}
