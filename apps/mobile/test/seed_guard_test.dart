// 「載入範例資料」的安全性質（見 spec C8）：
// 1. 它只新增、不刪除——已有的借款人、貸款、分錄一筆都不能少。
// 2. 呼叫端在庫裡已有資料時要能問出來，才做得到二次確認。
// 3. 範例身分證號不可與手動驗收腳本要求輸入的號碼撞號（撞號會被查重擋下，
//    整個載入中途失敗）。
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lending_engine/lending_engine.dart' as engine;
import 'package:mobile/db/app_database.dart';
import 'package:mobile/db/seed.dart';
import 'package:mobile/db/pii_codec.dart';
import 'package:mobile/domain/borrower_repository.dart';
import 'package:mobile/domain/loan_repository.dart';

(AppDatabase, BorrowerRepository, LoanRepository) _open() {
  final db = AppDatabase(NativeDatabase.memory());
  final codec = PiiCodec.fromPassphrase('test-passphrase-for-seed-guard');
  return (db, BorrowerRepository(db, codec), LoanRepository(db));
}

void main() {
  test('全新資料庫：summarizeExistingData 為空', () async {
    final (db, borrowers, loans) = _open();
    final summary = await summarizeExistingData(
      borrowers: borrowers,
      loans: loans,
    );
    expect(summary.isEmpty, isTrue);
    expect(summary.borrowers, 0);
    expect(summary.loans, 0);
    await db.close();
  });

  test('已有資料：summarizeExistingData 報得出數量（設定頁據此二次確認）', () async {
    final (db, borrowers, loans) = _open();
    final b = await borrowers.create(name: '王真實', idNumber: 'A123456789');
    await loans.registerLoan(
      borrowerId: b.id,
      principalCents: 5000000,
      method: engine.RepaymentMethod.emi,
      rateType: engine.RateType.monthly,
      rateBps: 100,
      dayCount: engine.DayCount.thirty360,
      tenorPeriods: 6,
      plannedDisbursementDate: DateTime.now(),
    );

    final summary = await summarizeExistingData(
      borrowers: borrowers,
      loans: loans,
    );
    expect(summary.isEmpty, isFalse);
    expect(summary.borrowers, 1);
    expect(summary.loans, 1);
    expect(summary.description, contains('1'));
    await db.close();
  });

  test('載入範例資料不會毀掉既有資料：原本那筆原封不動', () async {
    final (db, borrowers, loans) = _open();
    final existing = await borrowers.create(
      name: '王真實',
      idNumber: 'A123456789',
    );
    final existingLoan = await loans.registerLoan(
      borrowerId: existing.id,
      principalCents: 5000000,
      method: engine.RepaymentMethod.emi,
      rateType: engine.RateType.monthly,
      rateBps: 100,
      dayCount: engine.DayCount.thirty360,
      tenorPeriods: 6,
      plannedDisbursementDate: DateTime.now(),
    );
    await loans.confirmDisbursement(existingLoan.id);
    final int ledgerBefore = (await loans.ledgerFor(existingLoan.id)).length;

    await seedDemoData(borrowers: borrowers, loans: loans);

    // 原本的借款人與貸款都還在，內容也沒被改。
    final after = await borrowers.findById(existing.id);
    expect(after, isNotNull);
    expect(after!.name, '王真實');
    final loanAfter = await loans.findById(existingLoan.id);
    expect(loanAfter, isNotNull);
    expect(loanAfter!.principalCents, 5000000);
    expect((await loans.ledgerFor(existingLoan.id)).length, ledgerBefore);

    // 範例資料是「加上去」的：1 + 2 位借款人、1 + 2 筆貸款。
    final summary = await summarizeExistingData(
      borrowers: borrowers,
      loans: loans,
    );
    expect(summary.borrowers, 3);
    expect(summary.loans, 3);

    await db.close();
  });

  test('手動驗收用的 A123456789 已先被使用者輸入，範例資料仍載得進去（不撞號）', () async {
    final (db, borrowers, loans) = _open();
    await borrowers.create(name: '王真實', idNumber: 'A123456789');

    // 若範例資料還在用 A123456789，這裡會拋 DuplicateBorrowerException。
    await seedDemoData(borrowers: borrowers, loans: loans);

    expect((await borrowers.listAll()).length, 3);
    await db.close();
  });
}
