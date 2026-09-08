// docs/MANUAL-QA.md 的可執行版本。
//
// 手動驗收腳本裡寫的每一個預期數字，都在這裡被鎖住。有人改了引擎、瀑布或
// 看板定義而忘了更新文件，這支測試會先失敗——文件與程式不會悄悄分岔。
//
// 注意：這支測試「不」取代人工驗收。它跑的是 repository 層，證明不了觸控、
// 鍵盤遮擋、字級、真機效能，那些仍然只能靠人拿著手機走一次。
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lending_engine/lending_engine.dart' as engine;
import 'package:mobile/db/app_database.dart';
import 'package:mobile/db/pii_codec.dart';
import 'package:mobile/db/seed.dart';
import 'package:mobile/domain/borrower_repository.dart';
import 'package:mobile/domain/dashboard_repository.dart';
import 'package:mobile/domain/loan_repository.dart';

/// App 畫面顯示金額的規則（widgets/format.dart）：分 → 元，無條件捨去。
int displayedDollars(int cents) => cents ~/ 100;

void main() {
  late AppDatabase db;
  late LoanRepository loans;
  late DashboardRepository dashboard;

  setUp(() async {
    db = AppDatabase(NativeDatabase.memory());
    loans = LoanRepository(db);
    dashboard = DashboardRepository(loans);
    await db
        .into(db.borrowers)
        .insert(
          BorrowersCompanion.insert(
            id: 'qa-borrower',
            name: '王小明',
            idNumberCipher: 'cipher',
            idHash: 'hash',
            createdAt: DateTime.now(),
          ),
        );
  });

  tearDown(() async => db.close());

  /// MANUAL-QA.md 第 3 步使用的貸款：登記貸款表單的預設值原封不動送出。
  Future<Loan> registerQaLoan() => loans.registerLoan(
    borrowerId: 'qa-borrower',
    principalCents: 10000000, // 本金 100,000 元
    method: engine.RepaymentMethod.emi,
    rateType: engine.RateType.monthly,
    rateBps: 100, // 1%
    dayCount: engine.DayCount.thirty360,
    tenorPeriods: 12,
    plannedDisbursementDate: DateTime.now(),
  );

  group('MANUAL-QA 腳本預期值', () {
    test('第 3 步：計畫預覽 12 期，每期應繳顯示 NT\$8,884', () async {
      final loan = await registerQaLoan();
      final schedule = await loans.scheduleFor(loan.id);

      expect(schedule, hasLength(12));
      final first = schedule.first;
      expect(first.principalCents + first.interestCents, 888488);
      expect(displayedDollars(888488), 8884);
      expect(displayedDollars(first.principalCents), 7884);
      expect(displayedDollars(first.interestCents), 1000);
      expect(displayedDollars(first.closingBalanceCents), 92115);
      expect(schedule.last.closingBalanceCents, 0);
    });

    test('第 4 步：建約後、撥款前，看板全為 0 且沒有任何分錄（不變式 2）', () async {
      final loan = await registerQaLoan();

      expect(await loans.ledgerFor(loan.id), isEmpty);
      expect(loan.status, 'accepted');

      final snapshot = await dashboard.compute();
      expect(snapshot.totalDisbursedCents, 0);
      expect(snapshot.totalInterestReceivedCents, 0);
      expect(snapshot.totalReceivableCents, 0);
      expect(snapshot.totalOverdueCents, 0);
    });

    test('第 5 步：確認撥款後，貸款總額 NT\$100,000、分錄剛好 1 筆', () async {
      final loan = await registerQaLoan();
      await loans.confirmDisbursement(loan.id);

      final entries = await loans.ledgerFor(loan.id);
      expect(entries, hasLength(1));
      expect(entries.single.type, 'disbursement');
      expect(entries.single.amountCents, 10000000);

      final snapshot = await dashboard.compute();
      expect(displayedDollars(snapshot.totalDisbursedCents), 100000);
      expect(snapshot.totalInterestReceivedCents, 0);
      expect((await loans.findById(loan.id))!.status, 'current');
    });

    test('第 6 步：照畫面繳 8,884 元會短少 88 分，第 1 期變「部分」', () async {
      final loan = await registerQaLoan();
      await loans.confirmDisbursement(loan.id);
      await loans.recordPayment(
        loanId: loan.id,
        amountCents: 8884 * 100,
        paidAt: DateTime.now(),
      );

      final first = (await loans.scheduleFor(loan.id)).first;
      expect(first.status, 'partial');
      expect(first.interestPaidCents, 100000, reason: '瀑布：利息先收滿');
      expect(first.principalPaidCents, 788400);
      expect(first.principalCents - first.principalPaidCents, 88);

      final snapshot = await dashboard.compute();
      expect(displayedDollars(snapshot.totalInterestReceivedCents), 1000);
      final summary = await loans.replaySummary(loan.id);
      expect(summary.principalReceivedCents, 788400);
      expect(summary.outstandingPrincipalCents, 9211600);
    });

    test('第 7 步：補繳 1 元後第 1 期繳清，多的 12 分串到第 2 期利息', () async {
      final loan = await registerQaLoan();
      await loans.confirmDisbursement(loan.id);
      await loans.recordPayment(
        loanId: loan.id,
        amountCents: 8884 * 100,
        paidAt: DateTime.now(),
      );
      await loans.recordPayment(
        loanId: loan.id,
        amountCents: 100,
        paidAt: DateTime.now(),
      );

      final schedule = await loans.scheduleFor(loan.id);
      expect(schedule[0].status, 'prepaid', reason: '繳款日早於到期日 → 提前繳清');
      expect(schedule[0].principalPaidCents, 788488);
      expect(schedule[1].status, 'partial');
      expect(schedule[1].interestPaidCents, 12);

      final snapshot = await dashboard.compute();
      expect(snapshot.totalInterestReceivedCents, 100012);
      expect(displayedDollars(snapshot.totalInterestReceivedCents), 1000);
    });

    test('第 8 步：一次結清剩餘 NT\$97,733，狀態轉 SETTLED、餘額為 0', () async {
      final loan = await registerQaLoan();
      await loans.confirmDisbursement(loan.id);
      await loans.recordPayment(
        loanId: loan.id,
        amountCents: 8884 * 100,
        paidAt: DateTime.now(),
      );
      await loans.recordPayment(
        loanId: loan.id,
        amountCents: 100,
        paidAt: DateTime.now(),
      );

      final before = await loans.scheduleFor(loan.id);
      final remaining = before.fold<int>(
        0,
        (sum, i) =>
            sum +
            (i.principalCents - i.principalPaidCents) +
            (i.interestCents - i.interestPaidCents),
      );
      expect(remaining, 9773353);
      expect(displayedDollars(remaining), 97733);

      await loans.recordPayment(
        loanId: loan.id,
        amountCents: remaining,
        paidAt: DateTime.now(),
      );

      final after = await loans.scheduleFor(loan.id);
      for (final item in after) {
        expect(item.principalPaidCents, item.principalCents);
        expect(item.interestPaidCents, item.interestCents);
      }
      expect((await loans.findById(loan.id))!.status, 'settled');

      final summary = await loans.replaySummary(loan.id);
      expect(summary.principalReceivedCents, 10000000, reason: '已收本金＝原始本金');
      expect(summary.interestReceivedCents, 661853, reason: '全期利息');
      expect(summary.outstandingPrincipalCents, 0);

      final snapshot = await dashboard.compute();
      expect(displayedDollars(snapshot.totalInterestReceivedCents), 6618);
      expect(snapshot.totalOverdueCents, 0);
    });

    test('第 9 步：逾期情境（補登 70 天前撥款）第 1、2 期逾期共 NT\$35,624', () async {
      final loan = await loans.registerLoan(
        borrowerId: 'qa-borrower',
        principalCents: 10000000,
        method: engine.RepaymentMethod.epp,
        rateType: engine.RateType.annual,
        rateBps: 1500,
        dayCount: engine.DayCount.thirty360,
        tenorPeriods: 6,
        plannedDisbursementDate: DateTime.now(),
      );
      await loans.confirmDisbursement(
        loan.id,
        at: DateTime.now().subtract(const Duration(days: 70)),
      );
      await loans.runDailyBatch(loanId: loan.id);

      final schedule = await loans.scheduleFor(loan.id);
      expect(schedule[0].status, 'overdue');
      expect(schedule[1].status, 'overdue');
      expect(schedule[2].status, 'due');
      expect((await loans.findById(loan.id))!.status, 'delinquent');

      final snapshot = await dashboard.compute();
      expect(snapshot.totalOverdueCents, 3562499);
      expect(displayedDollars(snapshot.totalOverdueCents), 35624);
      expect(snapshot.totalReceivableCents, 3562499);
    });

    test('第 9 步（接續第 1～8 步）：載入範例資料後看板為 400,000 / 9,018 / 35,624', () async {
      // 第 1～8 步：結清一筆 10 萬 EMI。
      final loan = await registerQaLoan();
      await loans.confirmDisbursement(loan.id);
      await loans.recordPayment(
        loanId: loan.id,
        amountCents: 8884 * 100,
        paidAt: DateTime.now(),
      );
      await loans.recordPayment(
        loanId: loan.id,
        amountCents: 100,
        paidAt: DateTime.now(),
      );
      await loans.recordPayment(
        loanId: loan.id,
        amountCents: 9773353,
        paidAt: DateTime.now(),
      );
      expect((await loans.findById(loan.id))!.status, 'settled');

      // 第 9 步：載入範例資料。範例借款人的身分證必須與 MANUAL-QA 第 2 步
      // 使用的 A123456789 不同，否則查重會擋下、整個載入中途失敗。
      await seedDemoData(
        borrowers: BorrowerRepository(db, PiiCodec.fromPassphrase('qa')),
        loans: loans,
      );

      expect((await loans.listAll()), hasLength(3));

      final snapshot = await dashboard.compute();
      // 已結清的貸款仍計入撥款總額：撥出去的錢不會因為收回來就沒發生過。
      expect(displayedDollars(snapshot.totalDisbursedCents), 400000);
      expect(displayedDollars(snapshot.totalInterestReceivedCents), 9018);
      expect(displayedDollars(snapshot.totalReceivableCents), 35624);
      expect(displayedDollars(snapshot.totalOverdueCents), 35624);
    });

    test('已知缺陷（文件「還不能封測」第 2 項）：撥款後待收金額仍顯示 0', () async {
      // 借款人實際還欠 100,000 元本金＋利息，但因為第 1 期到期日在 30 天後，
      // 「待收金額」的定義（已出帳未收）讓看板顯示 NT$0。
      // 這個斷言存在的目的不是宣告行為正確，而是把已知的誤導行為釘住：
      // 哪天定義改了，這裡會失敗，提醒同步更新 MANUAL-QA.md 與看板說明。
      final loan = await registerQaLoan();
      await loans.confirmDisbursement(loan.id);

      final snapshot = await dashboard.compute();
      expect(displayedDollars(snapshot.totalDisbursedCents), 100000);
      expect(snapshot.totalReceivableCents, 0);
    });
  });
}
