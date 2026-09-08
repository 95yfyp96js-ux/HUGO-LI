// packages/lending_engine 之外，這裡驗證 Drift repository 層本身：部分還本、
// 全額清償後期末餘額為 0、狀態機正確推進到 SETTLED（見 spec 完成定義）。
// 純 Dart 測試（不需要 widget tree），用 in-memory Drift 資料庫。
import 'package:drift/drift.dart' hide isNotNull;
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
      await loanRepo.confirmDisbursement(loan.id);

      // 直接把第 1 期到期日改到 40 天前，模擬「早已過寬限期（預設 3 天）未繳」，
      // 測試日結的逾期判定與狀態轉移，不依賴等待真實時間流逝。
      final firstItem = (await loanRepo.scheduleFor(loan.id)).first;
      await (db.update(
        db.scheduleItems,
      )..where((t) => t.id.equals(firstItem.id))).write(
        ScheduleItemsCompanion(
          dueDate: Value(DateTime.now().subtract(const Duration(days: 40))),
        ),
      );

      await loanRepo.runDailyBatch(loanId: loan.id);

      final schedule = await loanRepo.scheduleFor(loan.id);
      expect(schedule.first.status, 'overdue');

      final updated = await loanRepo.findById(loan.id);
      expect(updated!.status, 'delinquent');

      await db.close();
    });
  });
}
