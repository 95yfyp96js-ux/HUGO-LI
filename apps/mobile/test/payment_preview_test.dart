// 收款預覽（spec B4）：溢繳與提前還本必須在入帳前被算出來、講清楚，
// 而且預覽本身不可以寫任何東西進資料庫。
//
// 同時釘住一個刻意的產品決定：在到期日之前繳掉「本期」是正常繳款，不算提前
// 還本、不跳提醒。每次都跳提醒，使用者就會閉著眼睛點過去，真正的溢繳提醒
// 也一起失效。
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lending_engine/lending_engine.dart' as engine;
import 'package:mobile/db/app_database.dart';
import 'package:mobile/domain/loan_repository.dart';
import 'package:mobile/domain/schedule_item_math.dart';

final DateTime disbursedAt = DateTime(2026, 1, 1);
final DateTime payDay = disbursedAt.add(const Duration(days: 5));

Future<(AppDatabase, LoanRepository, Loan)> _setUp() async {
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
  // 本金 100,000 元、EMI、月息 1%、12 期。
  final loan = await repo.registerLoan(
    borrowerId: 'b1',
    principalCents: 10000000,
    method: engine.RepaymentMethod.emi,
    rateType: engine.RateType.monthly,
    rateBps: 100,
    dayCount: engine.DayCount.thirty360,
    tenorPeriods: 12,
    plannedDisbursementDate: disbursedAt,
  );
  await repo.confirmDisbursement(loan.id, at: disbursedAt);
  return (db, repo, loan);
}

void main() {
  test('剛好繳本期（到期日之前）：不算溢繳、不算提前還本，不跳提醒', () async {
    final (db, repo, loan) = await _setUp();
    final items = await repo.scheduleFor(loan.id);
    expect(items.first.totalDueCents, 888488); // NT$8,884.88

    final preview = await repo.previewPayment(
      loanId: loan.id,
      amountCents: 888488,
      paidAt: payDay,
    );

    expect(preview.periodsTouched, 1);
    expect(preview.futurePeriodsTouched, 1, reason: '本期到期日還沒到');
    expect(preview.futurePeriodsBeyondCurrent, 0);
    expect(preview.isPrepayment, isFalse, reason: '正常繳款不該每次跳提醒');
    expect(preview.isOverpayment, isFalse);
    expect(preview.overpaymentCents, 0);
    await db.close();
  });

  test('繳兩期的錢：碰到本期以外的未到期期別 → 提前還本，要先問過', () async {
    final (db, repo, loan) = await _setUp();
    final items = await repo.scheduleFor(loan.id);
    final int twoPeriods = items[0].totalDueCents + items[1].totalDueCents;

    final preview = await repo.previewPayment(
      loanId: loan.id,
      amountCents: twoPeriods,
      paidAt: payDay,
    );

    expect(preview.periodsTouched, 2);
    expect(preview.futurePeriodsBeyondCurrent, 1);
    expect(preview.isPrepayment, isTrue);
    expect(preview.isOverpayment, isFalse);
    await db.close();
  });

  test('金額大於全部未繳：算得出溢繳金額，且沖銷金額加溢繳等於收款金額', () async {
    final (db, repo, loan) = await _setUp();
    final items = await repo.scheduleFor(loan.id);
    final int payoff = items.fold<int>(0, (s, i) => s + i.totalDueCents);

    final preview = await repo.previewPayment(
      loanId: loan.id,
      amountCents: payoff + 123456,
      paidAt: payDay,
    );

    expect(preview.isOverpayment, isTrue);
    expect(preview.overpaymentCents, 123456); // 多收 NT$1,234.56
    expect(
      preview.penaltyCents +
          preview.interestCents +
          preview.principalCents +
          preview.overpaymentCents,
      payoff + 123456,
      reason: '每一分錢都要有去處',
    );
    await db.close();
  });

  test('預覽不寫入任何東西：計畫表、分錄、實收紀錄都不變', () async {
    final (db, repo, loan) = await _setUp();
    final before = await repo.scheduleFor(loan.id);
    final ledgerBefore = (await repo.ledgerFor(loan.id)).length;
    final paymentsBefore = (await repo.paymentsFor(loan.id)).length;

    await repo.previewPayment(
      loanId: loan.id,
      amountCents: 99999999,
      paidAt: payDay,
    );

    final after = await repo.scheduleFor(loan.id);
    expect(
      after.map((i) => i.paidCents).toList(),
      before.map((i) => i.paidCents).toList(),
    );
    expect((await repo.ledgerFor(loan.id)).length, ledgerBefore);
    expect((await repo.paymentsFor(loan.id)).length, paymentsBefore);
    await db.close();
  });

  test('預覽的分配結果與實際入帳一致（同一套瀑布規則）', () async {
    final (db, repo, loan) = await _setUp();
    final items = await repo.scheduleFor(loan.id);
    final int amount = items[0].totalDueCents + items[1].totalDueCents;

    final preview = await repo.previewPayment(
      loanId: loan.id,
      amountCents: amount,
      paidAt: payDay,
    );
    await repo.recordPayment(
      loanId: loan.id,
      amountCents: amount,
      paidAt: payDay,
    );

    final after = await repo.scheduleFor(loan.id);
    final int actualInterest = after.fold<int>(
      0,
      (s, i) => s + i.interestPaidCents,
    );
    final int actualPrincipal = after.fold<int>(
      0,
      (s, i) => s + i.principalPaidCents,
    );
    expect(actualInterest, preview.interestCents);
    expect(actualPrincipal, preview.principalCents);
    await db.close();
  });
}
