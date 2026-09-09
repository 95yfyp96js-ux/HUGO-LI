import 'package:lending_engine/lending_engine.dart' as engine;

import '../money.dart';

/// 一筆貸款的鎖定條件。計畫表由這些條件經 `lending_engine` **重算**得出，
/// 不從資料庫的計畫表反推——這正是重放能抓到「有人手改計畫表」的原因。
class Loan {
  Loan({
    required this.id,
    required this.customerId,
    required this.principalCents,
    required this.method,
    required this.rateType,
    required this.rateBps,
    required this.dayCount,
    required this.tenorPeriods,
    required this.periodDays,
    required this.graceDays,
    required this.penaltyEnabled,
    required this.penaltyRateBps,
    required this.disbursedAt,
    required this.status,
  });

  final String id;
  final String customerId;
  final int principalCents;
  final String method;
  final String rateType;
  final int rateBps;
  final String dayCount;
  final int tenorPeriods;
  final int periodDays;
  final int graceDays;
  final bool penaltyEnabled;
  final int penaltyRateBps;
  final DateTime? disbursedAt;
  final String status;

  bool get isDisbursed => disbursedAt != null && status != 'draft';

  engine.LoanTerms terms() => engine.LoanTerms(
    principalCents: principalCents,
    method: engine.RepaymentMethod.values.byName(method),
    rateSpec: engine.RateSpec(
      rateType: engine.RateType.values.byName(rateType),
      rateBps: rateBps,
      dayCount: engine.DayCount.values.byName(dayCount),
      periodDays: periodDays,
    ),
    tenorPeriods: tenorPeriods,
    disbursedAt: disbursedAt!,
    graceDays: graceDays,
  );

  engine.RateSpec penaltySpec() => engine.RateSpec(
    rateType: engine.RateType.annual,
    rateBps: penaltyRateBps,
    dayCount: engine.DayCount.act365,
  );
}

/// 計畫表一期的現況（結構來自引擎重算，已繳金額來自資料庫）。
class PeriodState {
  PeriodState({
    required this.loanId,
    required this.seq,
    required this.dueDate,
    required this.principalCents,
    required this.interestCents,
    required this.feeCents,
    required this.principalPaidCents,
    required this.interestPaidCents,
    required this.feePaidCents,
    required this.penaltyPaidCents,
  });

  final String loanId;
  final int seq;
  final DateTime dueDate;
  final int principalCents;
  final int interestCents;
  final int feeCents;
  final int principalPaidCents;
  final int interestPaidCents;
  final int feePaidCents;
  final int penaltyPaidCents;

  int get dueTotalCents => principalCents + interestCents + feeCents;
  int get paidCents => principalPaidCents + interestPaidCents + feePaidCents;

  /// 尚差（不含罰息；罰息另外算，因為它每天長）。
  int get shortfallCents => dueTotalCents - paidCents;
  bool get isSettled => shortfallCents <= 0;

  bool isOverdue({required DateTime asOf, required int graceDays}) =>
      engine.isPastGrace(dueDate: dueDate, graceDays: graceDays, asOf: asOf);

  String get label => '第 $seq 期（${formatDate(dueDate)}）';
}

/// 一張票的現況。
///
/// `outstandingFaceCents = 票面 − 已兌現`。**部分兌現不改狀態**，剩下的票面
/// 仍算持有（見 docs/BOSS-SPEC.md C-3、D-2）。
class CheckState {
  CheckState({
    required this.id,
    required this.bankCode,
    required this.checkNo,
    required this.faceCents,
    required this.dueDate,
    required this.cashedAmountCents,
    required this.recourseAmountCents,
    required this.recoveredCents,
    required this.status,
  });

  final String id;
  final String bankCode;
  final String checkNo;
  final int faceCents;
  final DateTime dueDate;
  final int cashedAmountCents;
  final int recourseAmountCents;
  final int recoveredCents;
  final String status;

  int get outstandingFaceCents {
    final int remaining = faceCents - cashedAmountCents;
    return remaining > 0 ? remaining : 0;
  }

  int get recourseOutstandingCents {
    final int remaining = recourseAmountCents - recoveredCents;
    return remaining > 0 ? remaining : 0;
  }

  /// 畫面只顯示末四碼（docs/DATA-MIN.md 硬規則 2）。
  String get maskedCheckNo {
    if (checkNo.length <= 4) return '****$checkNo';
    return '****${checkNo.substring(checkNo.length - 4)}';
  }
}
