import 'package:ledger/ledger.dart';
import 'package:test/test.dart';

LedgerEntry _e(
  String id,
  LedgerEntryType type,
  int amount, {
  String loanId = 'L1',
  int? period,
}) =>
    LedgerEntry(
      id: id,
      loanId: loanId,
      type: type,
      amountCents: amount,
      postedAt: DateTime(2026, 1, 1),
      relatedPeriodNumber: period,
    );

void main() {
  group('replayLoan（重放）', () {
    test('依類型分桶累加', () {
      final entries = [
        _e('1', LedgerEntryType.disbursement, 1000000),
        _e('2', LedgerEntryType.accrual, 5000),
        _e('3', LedgerEntryType.penalty, 100),
        _e('4', LedgerEntryType.fee, 200),
        _e('5', LedgerEntryType.interest, 8000, period: 1),
        _e('6', LedgerEntryType.principal, 80000, period: 1),
        _e('7', LedgerEntryType.waiver, 300),
      ];
      final summary = replayLoan('L1', entries);

      expect(summary.disbursedCents, 1000000);
      expect(summary.accruedCents, 5000);
      expect(summary.penaltyReceivedCents, 100);
      expect(summary.feeReceivedCents, 200);
      expect(summary.interestReceivedCents, 8000);
      expect(summary.principalReceivedCents, 80000);
      expect(summary.waivedCents, 300);
      expect(summary.totalReceivedCents, 100 + 200 + 8000 + 80000);
      expect(summary.outstandingPrincipalCents, 1000000 - 80000);
    });

    test('只重放指定貸款，其他貸款分錄被忽略', () {
      final entries = [
        _e('1', LedgerEntryType.disbursement, 1000000, loanId: 'A'),
        _e('2', LedgerEntryType.disbursement, 2000000, loanId: 'B'),
      ];
      expect(replayLoan('A', entries).disbursedCents, 1000000);
      expect(replayLoan('B', entries).disbursedCents, 2000000);
      expect(replayLoan('C', entries).disbursedCents, 0);
    });

    test('adjustment 可沖正已入帳分錄（不變式 §3：只追加，不改寫）', () {
      final entries = [
        _e('1', LedgerEntryType.principal, 100000),
        // 發現分類錯誤，用調整分錄沖正，而非修改分錄 1。
        _e('2', LedgerEntryType.adjustment, -100000),
      ];
      final summary = replayLoan('L1', entries);
      expect(summary.principalReceivedCents, 100000);
      expect(summary.adjustmentCents, -100000);
      // outstanding = disbursed(0) - principalReceived(100000) + adjustment(-100000)
      expect(summary.outstandingPrincipalCents, -200000);
    });

    test('重放為純函式：相同輸入永遠得出相同結果', () {
      final entries = [
        _e('1', LedgerEntryType.disbursement, 500000),
        _e('2', LedgerEntryType.interest, 5000),
      ];
      final a = replayLoan('L1', entries);
      final b = replayLoan('L1', entries);
      expect(a.disbursedCents, b.disbursedCents);
      expect(a.interestReceivedCents, b.interestReceivedCents);
    });

    test('空分錄回傳全 0 摘要', () {
      final summary = replayLoan('L1', const []);
      expect(summary.disbursedCents, 0);
      expect(summary.totalReceivedCents, 0);
      expect(summary.outstandingPrincipalCents, 0);
    });
  });
}
