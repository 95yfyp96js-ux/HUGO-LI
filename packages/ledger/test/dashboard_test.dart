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
    test('單一貸款：正常繳款情境', () {
      final entries = [
        _e('1', 'A', LedgerEntryType.disbursement, 1000000),
        _e('2', 'A', LedgerEntryType.interest, 10000),
        _e('3', 'A', LedgerEntryType.principal, 80000),
      ];
      final billing = [
        const LoanBillingSnapshot(
          loanId: 'A',
          totalBilledCents: 100000, // 已出帳第 1 期：本金 80000 + 利息 10000（+ 罰息不適用）
          overdueBilledCents: 0,
          unbilledAccruedCents: 5000,
        ),
      ];
      final snapshot =
          computeDashboard(allEntries: entries, billingSnapshots: billing);

      expect(snapshot.totalDisbursedCents, 1000000);
      expect(snapshot.totalInterestReceivedCents, 10000);
      // 待收 = (100000 已出帳 + 5000 未出帳應計) - 90000 已收 = 15000
      expect(snapshot.totalReceivableCents, 15000);
      expect(snapshot.totalOverdueCents, 0);
    });

    test('逾期情境：逾期已出帳金額扣除已收後即為逾期金額', () {
      final entries = [
        _e('1', 'A', LedgerEntryType.disbursement, 1000000),
      ];
      final billing = [
        const LoanBillingSnapshot(
          loanId: 'A',
          totalBilledCents: 100000,
          overdueBilledCents: 100000,
        ),
      ];
      final snapshot =
          computeDashboard(allEntries: entries, billingSnapshots: billing);
      expect(snapshot.totalOverdueCents, 100000);
      expect(snapshot.totalReceivableCents, 100000);
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
            loanId: 'A', totalBilledCents: 50000, overdueBilledCents: 0),
        const LoanBillingSnapshot(
            loanId: 'B', totalBilledCents: 80000, overdueBilledCents: 0),
      ];
      final snapshot =
          computeDashboard(allEntries: entries, billingSnapshots: billing);
      expect(snapshot.totalDisbursedCents, 3000000);
      expect(snapshot.totalInterestReceivedCents, 30000);
    });

    test('已收金額超過已出帳金額時待收不為負', () {
      final entries = [
        _e('1', 'A', LedgerEntryType.disbursement, 1000000),
        _e('2', 'A', LedgerEntryType.principal, 200000),
        _e('3', 'A', LedgerEntryType.interest, 10000),
      ];
      final billing = [
        const LoanBillingSnapshot(
            loanId: 'A', totalBilledCents: 50000, overdueBilledCents: 0),
      ];
      final snapshot =
          computeDashboard(allEntries: entries, billingSnapshots: billing);
      expect(snapshot.totalReceivableCents, 0);
      expect(snapshot.totalOverdueCents, 0);
    });

    test('沒有任何分錄與貸款時全部為 0', () {
      final snapshot =
          computeDashboard(allEntries: const [], billingSnapshots: const []);
      expect(snapshot.totalDisbursedCents, 0);
      expect(snapshot.totalInterestReceivedCents, 0);
      expect(snapshot.totalReceivableCents, 0);
      expect(snapshot.totalOverdueCents, 0);
    });
  });
}
