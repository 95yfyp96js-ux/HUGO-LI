import 'package:meta/meta.dart';

import 'rate.dart';

/// 還款方式（見 docs/interest-rules.md §3）。
enum RepaymentMethod { emi, epp, io, bullet }

/// 一筆貸款登記當下鎖定的所有計息／攤還參數（連同 [ruleVersion]）。
///
/// 這是純值物件（immutable），是計畫重算（可重算）的唯一輸入來源。
@immutable
class LoanTerms {
  const LoanTerms({
    required this.principalCents,
    required this.method,
    required this.rateSpec,
    required this.tenorPeriods,
    required this.disbursedAt,
    this.ruleVersion = 1,
    this.graceDays = 3,
  })  : assert(principalCents > 0, 'principalCents 必須大於 0'),
        assert(tenorPeriods > 0, 'tenorPeriods 必須大於 0');

  final int principalCents;
  final RepaymentMethod method;
  final RateSpec rateSpec;
  final int tenorPeriods;
  final DateTime disbursedAt;
  final int ruleVersion;
  final int graceDays;

  /// 依 [rateSpec.periodDays] 推算的每期到期日（第 1 期 = 撥款日 + periodDays）。
  DateTime dueDateForPeriod(int periodNumber) =>
      disbursedAt.add(Duration(days: rateSpec.periodDays * periodNumber));
}

/// 一期還款計畫項目（`schedule_items`）。Schedule 整體可重算、無副作用。
@immutable
class ScheduleItem {
  const ScheduleItem({
    required this.periodNumber,
    required this.dueDate,
    required this.openingBalanceCents,
    required this.principalCents,
    required this.interestCents,
    required this.closingBalanceCents,
  })  : assert(principalCents >= 0),
        assert(interestCents >= 0);

  final int periodNumber;
  final DateTime dueDate;
  final int openingBalanceCents;
  final int principalCents;
  final int interestCents;
  final int closingBalanceCents;

  int get totalDueCents => principalCents + interestCents;

  ScheduleItem copyWith({
    int? periodNumber,
    DateTime? dueDate,
    int? openingBalanceCents,
    int? principalCents,
    int? interestCents,
    int? closingBalanceCents,
  }) =>
      ScheduleItem(
        periodNumber: periodNumber ?? this.periodNumber,
        dueDate: dueDate ?? this.dueDate,
        openingBalanceCents: openingBalanceCents ?? this.openingBalanceCents,
        principalCents: principalCents ?? this.principalCents,
        interestCents: interestCents ?? this.interestCents,
        closingBalanceCents: closingBalanceCents ?? this.closingBalanceCents,
      );

  @override
  String toString() =>
      'ScheduleItem(#$periodNumber due=$dueDate open=$openingBalanceCents '
      'principal=$principalCents interest=$interestCents '
      'close=$closingBalanceCents)';
}

/// 整份還款計畫的產出結果。
@immutable
class ScheduleResult {
  const ScheduleResult(this.items);

  final List<ScheduleItem> items;

  int get totalPrincipalCents =>
      items.fold(0, (sum, item) => sum + item.principalCents);

  int get totalInterestCents =>
      items.fold(0, (sum, item) => sum + item.interestCents);

  /// 不變式 §7.1／§7.2：本金加總須等於貸款本金，末期餘額須為 0。
  /// 由呼叫端（測試）驗證，此處僅提供便利存取。
  int get finalBalanceCents =>
      items.isEmpty ? 0 : items.last.closingBalanceCents;
}
