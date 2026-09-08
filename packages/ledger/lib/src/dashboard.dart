import 'package:meta/meta.dart';

import 'ledger_entry.dart';
import 'replay.dart';

/// 一筆貸款在計算看板時所需的「合約應收」資訊，由呼叫端（app repository 層，
/// 結合 `lending_engine` 產生的 Schedule 與各期狀態）提供。Ledger 套件本身
/// 不重算攤還計畫，只負責把它與「已收金額」重放比對。
///
/// 見 docs/ASSUMPTIONS.md §8：逾期金額以「已出帳且逾寬限期未繳期別」的
/// 應繳總額估算；因還款採期別由舊到新沖銷，已收金額優先視為沖銷最舊
/// （逾期）期別。
@immutable
class LoanBillingSnapshot {
  const LoanBillingSnapshot({
    required this.loanId,
    required this.totalBilledCents,
    required this.overdueBilledCents,
    this.unpaidInterestCents = 0,
    this.unbilledAccruedCents = 0,
  })  : assert(totalBilledCents >= 0),
        assert(overdueBilledCents >= 0),
        assert(overdueBilledCents <= totalBilledCents),
        assert(unpaidInterestCents >= 0),
        assert(unbilledAccruedCents >= 0);

  final String loanId;

  /// 已出帳（dueDate <= asOf）期別之應繳本金＋利息加總。
  final int totalBilledCents;

  /// 上述已出帳期別中，逾寬限期未繳者之應繳本金＋利息加總（totalBilledCents 的子集）。
  final int overdueBilledCents;

  /// **合約上尚未收到的利息**：全部未繳清期別（含尚未到期）的利息缺口加總。
  /// 這是「這筆放款還有多少利息沒進來」，不是「現在就該收」。
  final int unpaidInterestCents;

  /// 尚未出帳（下一期未到）之日結應計利息。
  final int unbilledAccruedCents;
}

/// 看板指標（見 docs/ASSUMPTIONS.md §8）。全部數字皆由 Ledger 重放得出，
/// 不直接加總 Schedule（不變式 §6）。
///
/// 「待收金額」＝[totalOutstandingPrincipalCents] ＋ [totalUnpaidInterestCents]，
/// 也就是**這些放款還有多少錢沒回來**。刻意不採用「已出帳未收」的定義：
/// 撥出去 10 萬、第 1 期還沒到期時，前者顯示 10 萬多，後者會顯示 0，
/// 而出借人看到 0 只會理解成「沒人欠我錢」。
@immutable
class DashboardSnapshot {
  const DashboardSnapshot({
    required this.totalDisbursedCents,
    required this.totalInterestReceivedCents,
    required this.totalOutstandingPrincipalCents,
    required this.totalUnpaidInterestCents,
    required this.totalOverdueCents,
  });

  /// 累計撥款金額（含已結清者——撥出去就是撥出去了）。
  final int totalDisbursedCents;

  /// 累計已收利息。
  final int totalInterestReceivedCents;

  /// 在貸本金：已撥款 − 已收本金（± 調整分錄），由分錄重放得出。
  final int totalOutstandingPrincipalCents;

  /// 待收利息：合約上尚未收到的利息（含未到期）。
  final int totalUnpaidInterestCents;

  /// 逾期金額：已出帳、逾寬限期仍未繳清的應繳合計。
  final int totalOverdueCents;

  /// 待收金額＝在貸本金＋待收利息。
  int get totalReceivableCents =>
      totalOutstandingPrincipalCents + totalUnpaidInterestCents;
}

/// 依 [allEntries]（跨所有貸款的分錄）與各貸款的 [billingSnapshots] 計算看板。
DashboardSnapshot computeDashboard({
  required List<LedgerEntry> allEntries,
  required List<LoanBillingSnapshot> billingSnapshots,
}) {
  final Set<String> loanIds = {
    for (final s in billingSnapshots) s.loanId,
    for (final e in allEntries) e.loanId,
  };
  final Map<String, LoanBillingSnapshot> billingByLoan = {
    for (final s in billingSnapshots) s.loanId: s,
  };

  int totalDisbursed = 0;
  int totalInterestReceived = 0;
  int totalOutstandingPrincipal = 0;
  int totalUnpaidInterest = 0;
  int totalOverdue = 0;

  for (final loanId in loanIds) {
    final summary = replayLoan(loanId, allEntries);
    totalDisbursed += summary.disbursedCents;
    totalInterestReceived += summary.interestReceivedCents;

    // 在貸本金由分錄重放得出：撥款 − 已收本金 ± 調整。收超過撥款時不倒扣。
    final int outstanding = summary.outstandingPrincipalCents;
    if (outstanding > 0) totalOutstandingPrincipal += outstanding;

    final billing = billingByLoan[loanId];
    if (billing == null) continue;

    totalUnpaidInterest +=
        billing.unpaidInterestCents + billing.unbilledAccruedCents;

    final int overdueUnpaid =
        billing.overdueBilledCents - summary.totalReceivedCents;
    if (overdueUnpaid > 0) totalOverdue += overdueUnpaid;
  }

  return DashboardSnapshot(
    totalDisbursedCents: totalDisbursed,
    totalInterestReceivedCents: totalInterestReceived,
    totalOutstandingPrincipalCents: totalOutstandingPrincipal,
    totalUnpaidInterestCents: totalUnpaidInterest,
    totalOverdueCents: totalOverdue,
  );
}
