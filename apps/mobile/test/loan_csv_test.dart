// 單筆貸款 CSV 匯出（spec C9）。CSV 會被丟進 Excel、用 email 寄來寄去，所以
// 這裡最重要的一條是：**檔案裡不能出現未遮罩的身分證字號**。
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lending_engine/lending_engine.dart' as engine;
import 'package:mobile/db/app_database.dart';
import 'package:mobile/db/pii_codec.dart';
import 'package:mobile/domain/borrower_repository.dart';
import 'package:mobile/domain/loan_csv.dart';
import 'package:mobile/domain/loan_repository.dart';

final DateTime disbursedAt = DateTime(2026, 1, 1);

void main() {
  test('CSV 內容：含計畫表、實收、分錄，且身分證字號已遮罩', () async {
    final db = AppDatabase(NativeDatabase.memory());
    final codec = PiiCodec.fromPassphrase('test-passphrase-for-csv');
    final borrowers = BorrowerRepository(db, codec);
    final repo = LoanRepository(db);

    final borrower = await borrowers.create(
      name: '王小明',
      idNumber: 'A123456789',
    );
    final loan = await repo.registerLoan(
      borrowerId: borrower.id,
      principalCents: 10000000,
      method: engine.RepaymentMethod.emi,
      rateType: engine.RateType.monthly,
      rateBps: 100,
      dayCount: engine.DayCount.thirty360,
      tenorPeriods: 12,
      plannedDisbursementDate: disbursedAt,
    );
    await repo.confirmDisbursement(loan.id, at: disbursedAt);
    await repo.recordPayment(
      loanId: loan.id,
      amountCents: 888488,
      paidAt: disbursedAt.add(const Duration(days: 30)),
      note: '第 1 期',
    );

    final csv = buildLoanCsv(
      loan: (await repo.findById(loan.id))!,
      borrowerName: borrower.name,
      maskedIdNumber: borrowers.maskedIdNumber(borrower),
      schedule: await repo.scheduleFor(loan.id),
      payments: await repo.paymentsFor(loan.id),
      ledger: await repo.ledgerFor(loan.id),
    );

    // 1. 個資：明文證號絕不可出現，只放遮罩後的末 4 碼。
    expect(csv.contains('A123456789'), isFalse, reason: 'CSV 不可帶未遮罩證號');
    expect(csv, contains('6789'));

    // 2. 四個區塊都在。
    expect(csv, contains('# 貸款基本資料'));
    expect(csv, contains('# 還款計畫'));
    expect(csv, contains('# 實收紀錄'));
    expect(csv, contains('# 分錄（append-only）'));

    // 3. 金額以「元.分」輸出，不四捨五入掉分。
    expect(csv, contains('8884.88'), reason: '第 1 期應繳合計必須看得到分');
    expect(csv, contains('100000.00'), reason: '本金 10 萬');

    // 4. 12 期都在（表頭 1 行 + 12 期）。
    final scheduleSection = csv.split('# 還款計畫').last.split('# 實收紀錄').first;
    final rows = scheduleSection
        .trim()
        .split('\n')
        .where((l) => l.trim().isNotEmpty)
        .toList();
    expect(rows.length, 13);

    // 5. 實收紀錄與備註。
    expect(csv, contains('第 1 期'));

    await db.close();
  });

  test('備註含逗號時會被雙引號包起來，不會把欄位切歪', () async {
    final db = AppDatabase(NativeDatabase.memory());
    final codec = PiiCodec.fromPassphrase('test-passphrase-for-csv-2');
    final borrowers = BorrowerRepository(db, codec);
    final repo = LoanRepository(db);

    final borrower = await borrowers.create(
      name: '李,小華',
      idNumber: 'B234567890',
    );
    final loan = await repo.registerLoan(
      borrowerId: borrower.id,
      principalCents: 1000000,
      method: engine.RepaymentMethod.bullet,
      rateType: engine.RateType.monthly,
      rateBps: 100,
      dayCount: engine.DayCount.thirty360,
      tenorPeriods: 1,
      plannedDisbursementDate: disbursedAt,
    );
    await repo.confirmDisbursement(loan.id, at: disbursedAt);
    await repo.recordPayment(
      loanId: loan.id,
      amountCents: 1000,
      paidAt: disbursedAt.add(const Duration(days: 1)),
      note: '現金,分兩次給',
    );

    final csv = buildLoanCsv(
      loan: (await repo.findById(loan.id))!,
      borrowerName: borrower.name,
      maskedIdNumber: borrowers.maskedIdNumber(borrower),
      schedule: await repo.scheduleFor(loan.id),
      payments: await repo.paymentsFor(loan.id),
      ledger: await repo.ledgerFor(loan.id),
    );

    expect(csv, contains('"李,小華"'));
    expect(csv, contains('"現金,分兩次給"'));
    expect(csv.contains('B234567890'), isFalse);

    await db.close();
  });
}
