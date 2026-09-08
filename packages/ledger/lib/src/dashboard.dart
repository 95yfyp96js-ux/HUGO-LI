import 'package:meta/meta.dart';

import 'ledger_entry.dart';
import 'replay.dart';

/// 一筆貸款在計算看板時所需的「出帳」資訊，由呼叫端（app repository 層，
/// 結合 `lending_engine` 產生的 Schedule 與各期狀態）提供。Ledger 套件本身
/// 不重算攤還計畫，只負責把「出帳金額」與「已收金額」重放比對。
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
    this.unbilledAccruedCents = 0,
  })  : assert(totalBilledCents >= 0),
        assert(overdueBilledCents >= 0),
        assert(overdueBilledCents <= totalBilledCents),
        assert(unbilledAccruedCents >= 0);

  final String loanId;

  /// 已出帳（dueDate <= asOf）期別之應繳本金＋利息加總。
  final int totalBilledCents;

  /// 上述已出帳期別中，逾寬限期未繳者之應繳本金＋利息加總（totalBilledCents 的子集）。
  final int overdueBilledCents;

  /// 尚未出帳（下一期未到）之日結應計利息。
  final int unbilledAccruedCents;
}

/// 看板四項指標（見 docs/ASSUMPTIONS.md §8）：貸款總額／已收利息／待收金額／逾期金額。
/// 全部數字皆由 Ledger 重放得出，不直接加總 Schedule（不變式 §6）。
@immutable
class DashboardSnapshot {
  const DashboardSnapshot({
    required this.totalDisbursedCents,
    required this.totalInterestReceivedCents,
    required this.totalReceivableCents,
    required this.totalOverdueCents,
  });

  final int totalDisbursedCents;
  final int totalInterestReceivedCents;
  final int totalReceivableCents;
  final int totalOverdueCents;
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
  int totalReceivable = 0;
  int totalOverdue = 0;

  for (final loanId in loanIds) {
    final summary = replayLoan(loanId, allEntries);
    totalDisbursed += summary.disbursedCents;
    totalInterestReceived += summary.interestReceivedCents;

    final billing = billingByLoan[loanId];
    if (billing == null) continue;

    final int receivedTowardBilled = summary.totalReceivedCents;

    final int receivable = billing.totalBilledCents +
        billing.unbilledAccruedCents -
        receivedTowardBilled;
    if (receivable > 0) totalReceivable += receivable;

    final int overdueUnpaid = billing.overdueBilledCents - receivedTowardBilled;
    if (overdueUnpaid > 0) totalOverdue += overdueUnpaid;
  }

  return DashboardSnapshot(
    totalDisbursedCents: totalDisbursed,
    totalInterestReceivedCents: totalInterestReceived,
    totalReceivableCents: totalReceivable,
    totalOverdueCents: totalOverdue,
  );
}
