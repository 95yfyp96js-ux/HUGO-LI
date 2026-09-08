import 'package:meta/meta.dart';

import 'ledger_entry.dart';

/// 單一貸款重放（replay）分錄後得出的累計數。純函式：對相同輸入永遠得出
/// 相同結果，可隨時重新計算，不依賴任何快取欄位。
@immutable
class LoanReplaySummary {
  const LoanReplaySummary({
    required this.disbursedCents,
    required this.accruedCents,
    required this.penaltyReceivedCents,
    required this.feeReceivedCents,
    required this.interestReceivedCents,
    required this.principalReceivedCents,
    required this.adjustmentCents,
    required this.waivedCents,
  });

  final int disbursedCents;
  final int accruedCents;
  final int penaltyReceivedCents;
  final int feeReceivedCents;
  final int interestReceivedCents;
  final int principalReceivedCents;

  /// 沖正調整淨額（可正可負）。
  final int adjustmentCents;
  final int waivedCents;

  /// 已收現金總額（罰息＋費用＋利息＋本金）。
  int get totalReceivedCents =>
      penaltyReceivedCents +
      feeReceivedCents +
      interestReceivedCents +
      principalReceivedCents;

  /// 未償本金（撥款 - 已收本金 + 調整）。
  int get outstandingPrincipalCents =>
      disbursedCents - principalReceivedCents + adjustmentCents;
}

/// 重放 [entries] 中屬於 [loanId] 的所有分錄，得出累計摘要。
LoanReplaySummary replayLoan(String loanId, Iterable<LedgerEntry> entries) {
  int disbursed = 0;
  int accrued = 0;
  int penalty = 0;
  int fee = 0;
  int interest = 0;
  int principal = 0;
  int adjustment = 0;
  int waived = 0;

  for (final e in entries) {
    if (e.loanId != loanId) continue;
    switch (e.type) {
      case LedgerEntryType.disbursement:
        disbursed += e.amountCents;
      case LedgerEntryType.accrual:
        accrued += e.amountCents;
      case LedgerEntryType.penalty:
        penalty += e.amountCents;
      case LedgerEntryType.fee:
        fee += e.amountCents;
      case LedgerEntryType.interest:
        interest += e.amountCents;
      case LedgerEntryType.principal:
        principal += e.amountCents;
      case LedgerEntryType.adjustment:
        adjustment += e.amountCents;
      case LedgerEntryType.waiver:
        waived += e.amountCents;
    }
  }

  return LoanReplaySummary(
    disbursedCents: disbursed,
    accruedCents: accrued,
    penaltyReceivedCents: penalty,
    feeReceivedCents: fee,
    interestReceivedCents: interest,
    principalReceivedCents: principal,
    adjustmentCents: adjustment,
    waivedCents: waived,
  );
}
