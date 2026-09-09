// 罰息在 repository 層的長情境：連續逾期好幾期時，每一期各自從自己的寬限期
// 結束日起算，而不是拿逾期總額乘最長天數（見 docs/interest-rules.md §7）。
//
// 期望值由 Python Fraction 參考實作獨立算出，並與
// packages/lending_engine/test/penalty_test.dart 的元件級數字互相對照。
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lending_engine/lending_engine.dart' as engine;
import 'package:mobile/db/app_database.dart';
import 'package:mobile/domain/loan_repository.dart';
import 'package:mobile/domain/schedule_item_math.dart';

/// 情境：本金 100,000 元、EPP 等額本金、月息 1%、6 期、每期 30 天、寬限 3 天，
/// 罰息年息 6%（ACT/365）。撥款日固定在 asOf 的 120 天前，一期都沒繳。
///
/// 到期日：第 30、60、90、120 天。asOf = 第 120 天時：
///   第 1 期 逾期 87 天（120 − 33）
///   第 2 期 逾期 57 天（120 − 63）
///   第 3 期 逾期 27 天（120 − 93）
///   第 4 期 當天到期、還在寬限期內 → 0
final DateTime asOf = DateTime(2026, 5, 1);
final DateTime disbursedAt = asOf.subtract(const Duration(days: 120));

Future<(AppDatabase, LoanRepository, Loan)> _setUp({
  required bool penaltyEnabled,
}) async {
  final db = AppDatabase(NativeDatabase.memory());
  final repo = LoanRepository(db);
  await db
      .into(db.borrowers)
      .insert(
        BorrowersCompanion.insert(
          id: 'b1',
          name: '測試借款人',
          idNumberCipher: 'x',
          idHash: 'x',
          createdAt: DateTime.now(),
        ),
      );
  final loan = await repo.registerLoan(
    borrowerId: 'b1',
    principalCents: 10000000,
    method: engine.RepaymentMethod.epp,
    rateType: engine.RateType.monthly,
    rateBps: 100,
    dayCount: engine.DayCount.thirty360,
    tenorPeriods: 6,
    plannedDisbursementDate: disbursedAt,
    penaltyEnabled: penaltyEnabled,
    penaltyRateBps: 600,
  );
  await repo.confirmDisbursement(loan.id, at: disbursedAt);
  return (db, repo, loan);
}

void main() {
  group('連續逾期 3 期的罰息', () {
    test('計畫表本身：前三期的本息合計是罰息的計算基礎', () async {
      final (db, repo, loan) = await _setUp(penaltyEnabled: true);
      final items = await repo.scheduleFor(loan.id);

      expect(items[0].principalCents, 1666666);
      expect(items[0].interestCents, 100000); // 100,000.00 × 1%
      expect(items[0].totalDueCents, 1766666);

      expect(items[1].principalCents, 1666666);
      expect(items[1].interestCents, 83333); // 83,333.34 → 四捨五入至分
      expect(items[1].totalDueCents, 1749999);

      expect(items[2].principalCents, 1666666);
      expect(items[2].interestCents, 66667); // 66,666.68 → 四捨五入至分
      expect(items[2].totalDueCents, 1733333);

      await db.close();
    });

    test('罰息啟用：合計 493.56 元（三期各自起算，第 4 期還在寬限期內不算）', () async {
      final (db, repo, loan) = await _setUp(penaltyEnabled: true);
      await repo.runDailyBatch(loanId: loan.id, asOf: asOf);

      expect(await repo.accruedPenaltyCents(loan.id, asOf: asOf), 49356);

      await db.close();
    });

    test('罰息關閉（預設）：同一情境一律 0，逾期本身不會變成錢', () async {
      final (db, repo, loan) = await _setUp(penaltyEnabled: false);
      await repo.runDailyBatch(loanId: loan.id, asOf: asOf);

      expect(await repo.accruedPenaltyCents(loan.id, asOf: asOf), 0);

      await db.close();
    });

    test('第 4 期仍在寬限期內：往後推一天就開始有罰息', () async {
      final (db, repo, loan) = await _setUp(penaltyEnabled: true);

      // 第 120 天：第 4 期當天到期，寬限到第 123 天。
      final int atDue = await repo.accruedPenaltyCents(loan.id, asOf: asOf);
      // 第 123 天：寬限最後一天，第 4 期仍不算逾期。
      final int atGraceEnd = await repo.accruedPenaltyCents(
        loan.id,
        asOf: asOf.add(const Duration(days: 3)),
      );
      // 第 124 天：第 4 期開始起算罰息。
      final int afterGrace = await repo.accruedPenaltyCents(
        loan.id,
        asOf: asOf.add(const Duration(days: 4)),
      );

      expect(atDue, 49356);
      // 三天過去，前三期各自多算 3 天罰息；第 4 期仍為 0。
      expect(atGraceEnd, greaterThan(atDue));
      expect(afterGrace, greaterThan(atGraceEnd));

      // 第 4 期第一天的罰息 = 該期本息 1,716,666 分 × 6%/365 × 1 天。
      final items = await repo.scheduleFor(loan.id);
      expect(items[3].totalDueCents, 1716666);
      final int period4Day1 = engine.accrueInterestCents(
        balanceCents: 1716666,
        rateSpec: const engine.RateSpec(
          rateType: engine.RateType.annual,
          rateBps: 600,
          dayCount: engine.DayCount.act365,
        ),
        from: asOf.add(const Duration(days: 3)),
        to: asOf.add(const Duration(days: 4)),
      );
      expect(period4Day1, 282); // 2.82 元
      expect(afterGrace - atGraceEnd, greaterThanOrEqualTo(period4Day1));

      await db.close();
    });

    test('繳清第 1 期後，第 1 期不再產生罰息', () async {
      final (db, repo, loan) = await _setUp(penaltyEnabled: true);
      await repo.runDailyBatch(loanId: loan.id, asOf: asOf);

      final int before = await repo.accruedPenaltyCents(loan.id, asOf: asOf);
      expect(before, 49356);

      // 第 1 期本息 + 罰息 25,266 分（見 lending_engine/test/penalty_test.dart）。
      await repo.recordPayment(
        loanId: loan.id,
        amountCents: 1766666 + 25266,
        paidAt: asOf,
      );

      final int after = await repo.accruedPenaltyCents(loan.id, asOf: asOf);
      expect(after, 49356 - 25266, reason: '只剩第 2、3 期的罰息');

      await db.close();
    });
  });
}
