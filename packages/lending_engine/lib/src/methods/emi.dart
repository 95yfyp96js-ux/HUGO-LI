import 'package:decimal/decimal.dart';
import 'package:rational/rational.dart';

import '../money.dart';
import '../schedule.dart';

/// EMI 等額本息（見 docs/interest-rules.md §3.1）。
ScheduleResult generateEmiSchedule(LoanTerms terms) {
  final int n = terms.tenorPeriods;
  final Decimal r = terms.rateSpec.ratePerPeriod();
  final Decimal p = centsToDecimal(terms.principalCents);

  final int levelPaymentCents;
  if (r == Decimal.zero) {
    // r = 0：每期本金 = P/n，餘數併入末期由末期分支自動吸收。
    levelPaymentCents = terms.principalCents ~/ n;
  } else {
    final Decimal onePlusR = Decimal.one + r;
    final Rational powN = onePlusR.pow(n);
    final Rational numerator = p.toRational() * r.toRational() * powN;
    final Rational denominator = powN - Rational.one;
    final Decimal aDecimal = toWorkingDecimal(numerator / denominator);
    levelPaymentCents = roundHalfUpToCents(aDecimal);
  }

  final items = <ScheduleItem>[];
  int balance = terms.principalCents;
  for (int t = 1; t <= n; t++) {
    final int opening = balance;
    final int interest = roundHalfUpToCents(centsToDecimal(opening) * r);
    final int principal;
    if (t == n) {
      // 末期：全部剩餘本金，保證帳務軋平（不變式 §7.2）。
      principal = opening;
    } else {
      principal = levelPaymentCents - interest;
    }
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
