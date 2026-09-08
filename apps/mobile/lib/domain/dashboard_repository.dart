import 'package:ledger/ledger.dart' as ledger;
import 'package:lending_engine/lending_engine.dart'; // LoanStatusX (isDisbursed 等擴充方法)

import 'enum_mapping.dart';
import 'loan_repository.dart';
import 'schedule_item_math.dart';

/// 看板聚合（見 docs/ASSUMPTIONS.md §8）：全部數字皆由
/// `packages/ledger` 重放 Ledger 得出，本層只負責把 Drift 資料整理成
/// `LoanBillingSnapshot` 餵給 `computeDashboard`，不直接加總 Schedule。
class DashboardRepository {
  DashboardRepository(this._loans);

  final LoanRepository _loans;

  Future<ledger.DashboardSnapshot> compute({DateTime? asOf}) async {
    final DateTime now = asOf ?? DateTime.now();
    final allEntries = (await _loans.allLedgerEntries())
        .map(mapLedgerEntryRow)
        .toList();
    final loans = await _loans.listAll();

    final List<ledger.LoanBillingSnapshot> billing = [];
    for (final loan in loans) {
      final status = parseLoanStatus(loan.status);
      if (!status.isDisbursed) continue; // 未撥款不計入貸款總額（不變式 6）。

      final items = await _loans.scheduleFor(loan.id);
      int totalBilled = 0;
      int overdueBilled = 0;
      int unpaidInterest = 0;
      for (final item in items) {
        // 合約上還沒收到的利息（含未到期期別）——「待收利息」的來源。
        if (!item.isSettledPeriod) {
          final int owed = item.interestCents - item.interestPaidCents;
          if (owed > 0) unpaidInterest += owed;
        }
        final bool billed = !item.dueDate.isAfter(now);
        if (!billed) continue;
        totalBilled += item.totalDueCents;
        if (item.status == 'overdue') {
          overdueBilled += item.totalDueCents;
        }
      }
      billing.add(
        ledger.LoanBillingSnapshot(
          loanId: loan.id,
          totalBilledCents: totalBilled,
          overdueBilledCents: overdueBilled,
          unpaidInterestCents: unpaidInterest,
        ),
      );
    }

    return ledger.computeDashboard(
      allEntries: allEntries,
      billingSnapshots: billing,
    );
  }
}

/// 貸款自身在還款頁需要的即時摘要（依 Ledger 重放，不加總 Schedule）。
class LoanSummary {
  const LoanSummary({
    required this.disbursedCents,
    required this.interestReceivedCents,
    required this.principalReceivedCents,
    required this.outstandingPrincipalCents,
  });

  final int disbursedCents;
  final int interestReceivedCents;
  final int principalReceivedCents;
  final int outstandingPrincipalCents;
}

extension LoanReplayX on LoanRepository {
  Future<LoanSummary> replaySummary(String loanId) async {
    final entries = (await ledgerFor(loanId)).map(mapLedgerEntryRow);
    final summary = ledger.replayLoan(loanId, entries);
    return LoanSummary(
      disbursedCents: summary.disbursedCents,
      interestReceivedCents: summary.interestReceivedCents,
      principalReceivedCents: summary.principalReceivedCents,
      outstandingPrincipalCents: summary.outstandingPrincipalCents,
    );
  }
}
