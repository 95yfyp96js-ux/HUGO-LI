import 'package:ledger/ledger.dart';
import 'package:test/test.dart';

LedgerEntry _e(String id, String loanId, LedgerEntryType type, int amount) =>
    LedgerEntry(
      id: id,
      loanId: loanId,
      type: type,
      amountCents: amount,
      postedAt: DateTime(2026, 2, 1),
    );

void main() {
  group('computeDashboard（看板聚合，全部由 Ledger 重放得出）', () {
    test('剛撥款、第 1 期尚未到期：待收＝在貸本金＋合約未收利息，絕不為 0', () {
      // 這是舊定義（已出帳未收）最嚴重的破口：撥出去 10 萬，看板卻顯示待收 0。
      final entries = [_e('1', 'A', LedgerEntryType.disbursement, 10000000)];
      final billing = [
        const LoanBillingSnapshot(
          loanId: 'A',
          totalBilledCents: 0, // 一期都還沒到期
          overdueBilledCents: 0,
          unpaidInterestCents: 661853,
        ),
      ];
      final snapshot = computeDashboard(
        allEntries: entries,
        billingSnapshots: billing,
      );

      expect(snapshot.totalDisbursedCents, 10000000);
      expect(snapshot.totalOutstandingPrincipalCents, 10000000);
      expect(snapshot.totalUnpaidInterestCents, 661853);
      expect(snapshot.totalReceivableCents, 10661853);
      expect(snapshot.totalOverdueCents, 0);
    });

    test('收了第 1 期後：在貸本金與待收利息同步減少', () {
      final entries = [
        _e('1', 'A', LedgerEntryType.disbursement, 10000000),
        _e('2', 'A', LedgerEntryType.interest, 100000),
        _e('3', 'A', LedgerEntryType.principal, 788488),
      ];
      final billing = [
        const LoanBillingSnapshot(
          loanId: 'A',
          totalBilledCents: 888488,
          overdueBilledCents: 0,
          unpaidInterestCents: 561853, // 661,853 − 100,000
        ),
      ];
      final snapshot = computeDashboard(
        allEntries: entries,
        billingSnapshots: billing,
      );

      expect(snapshot.totalInterestReceivedCents, 100000);
      expect(snapshot.totalOutstandingPrincipalCents, 10000000 - 788488);
      expect(snapshot.totalUnpaidInterestCents, 561853);
      expect(snapshot.totalReceivableCents, 9211512 + 561853);
    });

    test('全部結清：在貸本金與待收利息歸零，累計撥款仍保留', () {
      final entries = [
        _e('1', 'A', LedgerEntryType.disbursement, 10000000),
        _e('2', 'A', LedgerEntryType.interest, 661853),
        _e('3', 'A', LedgerEntryType.principal, 10000000),
      ];
      final billing = [
        const LoanBillingSnapshot(
          loanId: 'A',
          totalBilledCents: 10661853,
          overdueBilledCents: 0,
        ),
      ];
      final snapshot = computeDashboard(
        allEntries: entries,
        billingSnapshots: billing,
      );

      expect(snapshot.totalDisbursedCents, 10000000, reason: '撥出去就是撥出去了');
      expect(snapshot.totalOutstandingPrincipalCents, 0);
      expect(snapshot.totalUnpaidInterestCents, 0);
      expect(snapshot.totalReceivableCents, 0);
    });

    test('逾期情境：逾期已出帳金額扣除已收後即為逾期金額', () {
      final entries = [_e('1', 'A', LedgerEntryType.disbursement, 10000000)];
      final billing = [
        const LoanBillingSnapshot(
          loanId: 'A',
          totalBilledCents: 3562499,
          overdueBilledCents: 3562499,
          unpaidInterestCents: 437500,
        ),
      ];
      final snapshot = computeDashboard(
        allEntries: entries,
        billingSnapshots: billing,
      );
      expect(snapshot.totalOverdueCents, 3562499);
      expect(snapshot.totalReceivableCents, 10000000 + 437500);
    });

    test('未出帳應計利息併入待收利息', () {
      final entries = [_e('1', 'A', LedgerEntryType.disbursement, 1000000)];
      final billing = [
        const LoanBillingSnapshot(
          loanId: 'A',
          totalBilledCents: 0,
          overdueBilledCents: 0,
          unpaidInterestCents: 5000,
          unbilledAccruedCents: 1200,
        ),
      ];
      final snapshot = computeDashboard(
        allEntries: entries,
        billingSnapshots: billing,
      );
      expect(snapshot.totalUnpaidInterestCents, 6200);
    });

    test('多筆貸款加總', () {
      final entries = [
        _e('1', 'A', LedgerEntryType.disbursement, 1000000),
        _e('2', 'B', LedgerEntryType.disbursement, 2000000),
        _e('3', 'A', LedgerEntryType.interest, 10000),
        _e('4', 'B', LedgerEntryType.interest, 20000),
      ];
      final billing = [
        const LoanBillingSnapshot(
          loanId: 'A',
          totalBilledCents: 50000,
          overdueBilledCents: 0,
          unpaidInterestCents: 40000,
        ),
        const LoanBillingSnapshot(
          loanId: 'B',
          totalBilledCents: 80000,
          overdueBilledCents: 0,
          unpaidInterestCents: 60000,
        ),
      ];
      final snapshot = computeDashboard(
        allEntries: entries,
        billingSnapshots: billing,
      );
      expect(snapshot.totalDisbursedCents, 3000000);
      expect(snapshot.totalInterestReceivedCents, 30000);
      expect(snapshot.totalOutstandingPrincipalCents, 3000000);
      expect(snapshot.totalUnpaidInterestCents, 100000);
    });

    test('已收本金超過撥款（溢繳）時在貸本金不為負', () {
      final entries = [
        _e('1', 'A', LedgerEntryType.disbursement, 1000000),
        _e('2', 'A', LedgerEntryType.principal, 1200000),
      ];
      final billing = [
        const LoanBillingSnapshot(
          loanId: 'A',
          totalBilledCents: 1000000,
          overdueBilledCents: 0,
        ),
      ];
      final snapshot = computeDashboard(
        allEntries: entries,
        billingSnapshots: billing,
      );
      expect(snapshot.totalOutstandingPrincipalCents, 0);
      expect(snapshot.totalReceivableCents, 0);
    });

    test('沒有任何分錄與貸款時全部為 0', () {
      final snapshot = computeDashboard(
        allEntries: const [],
        billingSnapshots: const [],
      );
      expect(snapshot.totalDisbursedCents, 0);
      expect(snapshot.totalInterestReceivedCents, 0);
      expect(snapshot.totalOutstandingPrincipalCents, 0);
      expect(snapshot.totalUnpaidInterestCents, 0);
      expect(snapshot.totalReceivableCents, 0);
      expect(snapshot.totalOverdueCents, 0);
    });
  });
}
