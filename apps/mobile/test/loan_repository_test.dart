// packages/lending_engine 之外，這裡驗證 Drift repository 層本身：部分還本、
// 全額清償後期末餘額為 0、狀態機正確推進到 SETTLED（見 spec 完成定義）。
// 純 Dart 測試（不需要 widget tree），用 in-memory Drift 資料庫。
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lending_engine/lending_engine.dart' as engine;
import 'package:mobile/db/app_database.dart';
import 'package:mobile/domain/loan_repository.dart';

Future<AppDatabase> _openTestDatabase() async =>
    AppDatabase(NativeDatabase.memory());

Future<String> _seedBorrower(AppDatabase db) async {
  const id = 'borrower-1';
  await db
      .into(db.borrowers)
      .insert(
        BorrowersCompanion.insert(
          id: id,
          name: '測試借款人',
          idNumberCipher: 'x',
          idHash: 'x',
          createdAt: DateTime.now(),
        ),
      );
  return id;
}

void main() {
  group('LoanRepository', () {
    test('部分還本後，最終全額清償時期末餘額為 0，狀態轉為 SETTLED', () async {
      final db = await _openTestDatabase();
      final loanRepo = LoanRepository(db);
      final borrowerId = await _seedBorrower(db);

      final loan = await loanRepo.registerLoan(
        borrowerId: borrowerId,
        principalCents: 1000000,
        method: engine.RepaymentMethod.emi,
        rateType: engine.RateType.monthly,
        rateBps: 100,
        dayCount: engine.DayCount.thirty360,
        tenorPeriods: 3,
        plannedDisbursementDate: DateTime.now(),
      );
      await loanRepo.confirmDisbursement(loan.id);

      var schedule = await loanRepo.scheduleFor(loan.id);
      final totalDue = schedule.fold<int>(
        0,
        (sum, item) => sum + item.principalCents + item.interestCents,
      );

      // 部分還本：只繳一半。
      await loanRepo.recordPayment(
        loanId: loan.id,
        amountCents: totalDue ~/ 2,
        paidAt: DateTime.now(),
      );
      var mid = await loanRepo.scheduleFor(loan.id);
      expect(
        mid.any((i) => i.status == 'partial' || i.status == 'paid'),
        isTrue,
      );

      // 全額清償剩餘（多給一點確保覆蓋所有期）。
      await loanRepo.recordPayment(
        loanId: loan.id,
        amountCents: totalDue,
        paidAt: DateTime.now(),
      );

      schedule = await loanRepo.scheduleFor(loan.id);
      for (final item in schedule) {
        expect(
          item.interestPaidCents,
          item.interestCents,
          reason: 'period ${item.periodNumber} interest',
        );
        expect(
          item.principalPaidCents,
          item.principalCents,
          reason: 'period ${item.periodNumber} principal',
        );
      }
      final updatedLoan = await loanRepo.findById(loan.id);
      expect(updatedLoan!.status, 'settled');

      // 分錄可重放得出「已收本金」＝原始本金（不變式：Ledger 重放與 Schedule 一致）。
      final entries = await loanRepo.ledgerFor(loan.id);
      final principalReceived = entries
          .where((e) => e.type == 'principal')
          .fold<int>(0, (sum, e) => sum + e.amountCents);
      expect(principalReceived, loan.principalCents);

      await db.close();
    });

    test('登記貸款不寫入任何分錄；確認撥款才寫入 DISBURSEMENT（不變式 2）', () async {
      final db = await _openTestDatabase();
      final loanRepo = LoanRepository(db);
      final borrowerId = await _seedBorrower(db);

      final loan = await loanRepo.registerLoan(
        borrowerId: borrowerId,
        principalCents: 500000,
        method: engine.RepaymentMethod.io,
        rateType: engine.RateType.monthly,
        rateBps: 200,
        dayCount: engine.DayCount.thirty360,
        tenorPeriods: 4,
        plannedDisbursementDate: DateTime.now(),
      );

      expect(await loanRepo.ledgerFor(loan.id), isEmpty);
      expect(loan.status, 'accepted');

      await loanRepo.confirmDisbursement(loan.id);
      final entries = await loanRepo.ledgerFor(loan.id);
      expect(entries, hasLength(1));
      expect(entries.single.type, 'disbursement');
      expect(entries.single.amountCents, 500000);

      final updated = await loanRepo.findById(loan.id);
      expect(updated!.status, 'current');
      expect(updated.disbursedAt, isNotNull);

      await db.close();
    });

    test('未達 ACCEPTED 狀態不可確認撥款', () async {
      final db = await _openTestDatabase();
      final loanRepo = LoanRepository(db);
      final borrowerId = await _seedBorrower(db);

      final loan = await loanRepo.registerLoan(
        borrowerId: borrowerId,
        principalCents: 100000,
        method: engine.RepaymentMethod.bullet,
        rateType: engine.RateType.annual,
        rateBps: 1200,
        dayCount: engine.DayCount.act365,
        tenorPeriods: 3,
        plannedDisbursementDate: DateTime.now(),
      );
      await loanRepo.confirmDisbursement(loan.id);

      // 已撥款過一次，再次呼叫應拋出例外（狀態已不是 ACCEPTED）。
      expect(
        () => loanRepo.confirmDisbursement(loan.id),
        throwsA(isA<IllegalLoanTransitionException>()),
      );

      await db.close();
    });

    test('日結會將逾期未繳期別標記為 OVERDUE 並把貸款轉為 DELINQUENT', () async {
      final db = await _openTestDatabase();
      final loanRepo = LoanRepository(db);
      final borrowerId = await _seedBorrower(db);

      final loan = await loanRepo.registerLoan(
        borrowerId: borrowerId,
        principalCents: 300000,
        method: engine.RepaymentMethod.epp,
        rateType: engine.RateType.monthly,
        rateBps: 100,
        dayCount: engine.DayCount.thirty360,
        tenorPeriods: 3,
        plannedDisbursementDate: DateTime.now(),
      );

      // 補登 70 天前的歷史撥款：計畫表以該日為錨點，第 1、2 期（到期日
      // 40 天前、10 天前）都已過寬限期未繳。
      final backdated = DateTime.now().subtract(const Duration(days: 70));
      await loanRepo.confirmDisbursement(loan.id, at: backdated);

      await loanRepo.runDailyBatch(loanId: loan.id);

      final schedule = await loanRepo.scheduleFor(loan.id);
      expect(schedule[0].status, 'overdue');
      expect(schedule[1].status, 'overdue');
      expect(schedule[2].status, 'due'); // 到期日在 20 天後，尚未到期

      final updated = await loanRepo.findById(loan.id);
      expect(updated!.status, 'delinquent');
      expect(
        updated.disbursedAt!.difference(backdated).inSeconds.abs(),
        lessThan(2),
      );

      await db.close();
    });

    test('補登歷史撥款：撥款分錄與計息起算日都以實際撥款日為準', () async {
      final db = await _openTestDatabase();
      final loanRepo = LoanRepository(db);
      final borrowerId = await _seedBorrower(db);

      final loan = await loanRepo.registerLoan(
        borrowerId: borrowerId,
        principalCents: 600000,
        method: engine.RepaymentMethod.emi,
        rateType: engine.RateType.monthly,
        rateBps: 100,
        dayCount: engine.DayCount.thirty360,
        tenorPeriods: 6,
        plannedDisbursementDate: DateTime.now(),
      );
      final backdated = DateTime.now().subtract(const Duration(days: 45));
      await loanRepo.confirmDisbursement(loan.id, at: backdated);

      final entries = await loanRepo.ledgerFor(loan.id);
      expect(
        entries.single.postedAt.difference(backdated).inSeconds.abs(),
        lessThan(2),
      );

      final schedule = await loanRepo.scheduleFor(loan.id);
      expect(
        schedule.first.dueDate
            .difference(backdated.add(const Duration(days: 30)))
            .inSeconds
            .abs(),
        lessThan(2),
      );

      await db.close();
    });

    test('撥款日不可為未來日期', () async {
      final db = await _openTestDatabase();
      final loanRepo = LoanRepository(db);
      final borrowerId = await _seedBorrower(db);

      final loan = await loanRepo.registerLoan(
        borrowerId: borrowerId,
        principalCents: 100000,
        method: engine.RepaymentMethod.io,
        rateType: engine.RateType.monthly,
        rateBps: 100,
        dayCount: engine.DayCount.thirty360,
        tenorPeriods: 3,
        plannedDisbursementDate: DateTime.now(),
      );

      expect(
        () => loanRepo.confirmDisbursement(
          loan.id,
          at: DateTime.now().add(const Duration(days: 1)),
        ),
        throwsA(isA<ArgumentError>()),
      );
      // 失敗後狀態不變、仍未寫入任何分錄。
      expect((await loanRepo.findById(loan.id))!.status, 'accepted');
      expect(await loanRepo.ledgerFor(loan.id), isEmpty);

      await db.close();
    });
  });
}
