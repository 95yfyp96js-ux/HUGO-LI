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
import 'package:mobile/domain/schedule_item_math.dart';
import 'package:mobile/widgets/format.dart';

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
    test('第 3 步：計畫預覽 12 期，每期應繳顯示 NT\$8,884.88（精確到分）', () async {
      final loan = await registerQaLoan();
      final schedule = await loans.scheduleFor(loan.id);

      expect(schedule, hasLength(12));
      final first = schedule.first;
      expect(first.totalDueCents, 888488);
      expect(formatMoney(first.totalDueCents), 'NT\$8,884.88');
      expect(formatMoney(first.principalCents), 'NT\$7,884.88');
      expect(formatMoney(first.interestCents), 'NT\$1,000.00');
      expect(formatMoney(first.closingBalanceCents), 'NT\$92,115.12');
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

    test('第 5 步：撥款後待收金額＝在貸本金＋待收利息，絕不是 0', () async {
      final loan = await registerQaLoan();
      await loans.confirmDisbursement(loan.id);

      final entries = await loans.ledgerFor(loan.id);
      expect(entries, hasLength(1));
      expect(entries.single.type, 'disbursement');
      expect(entries.single.amountCents, 10000000);
      expect((await loans.findById(loan.id))!.status, 'current');

      final snapshot = await dashboard.compute();
      expect(formatMoney(snapshot.totalDisbursedCents), 'NT\$100,000.00');
      expect(snapshot.totalInterestReceivedCents, 0);

      // 這是修掉的第 2 項缺陷：撥出去 10 萬，待收不可以顯示 0。
      expect(snapshot.totalOutstandingPrincipalCents, 10000000);
      expect(snapshot.totalUnpaidInterestCents, 661853);
      expect(snapshot.totalReceivableCents, 10661853);
      expect(
        formatMoneyRounded(snapshot.totalOutstandingPrincipalCents),
        'NT\$100,000',
      );
      expect(
        formatMoneyRounded(snapshot.totalUnpaidInterestCents),
        'NT\$6,619',
      );
    });

    test('第 6 步：用對話框帶入的精確金額繳款，第 1 期一次繳清、不留尾差', () async {
      final loan = await registerQaLoan();
      await loans.confirmDisbursement(loan.id);

      // 對話框預設帶入的就是這個值，使用者不必自己算、也不必自己打。
      final suggestion = await loans.paymentSuggestion(loan.id);
      expect(suggestion.currentDueCents, 888488);
      expect(centsToInput(suggestion.currentDueCents), '8884.88');

      await loans.recordPayment(
        loanId: loan.id,
        amountCents: suggestion.currentDueCents,
        paidAt: DateTime.now(),
      );

      final first = (await loans.scheduleFor(loan.id)).first;
      expect(first.status, 'prepaid', reason: '繳款日早於到期日 → 提前繳清');
      expect(first.shortfallCents, 0, reason: '不再有 88 分的尾差');

      final snapshot = await dashboard.compute();
      expect(snapshot.totalInterestReceivedCents, 100000);
      expect(snapshot.totalOutstandingPrincipalCents, 9211512);
      expect(snapshot.totalUnpaidInterestCents, 561853);
      expect(snapshot.totalReceivableCents, 9773365);

      // 待收金額應該等於「一次結清」金額——兩個數字算法不同，對得起來才對。
      final after = await loans.paymentSuggestion(loan.id);
      expect(after.payoffCents, snapshot.totalReceivableCents);
    });

    test('第 7 步：故意只繳整數 8,884 元時，畫面必須看得到「尚差 NT\$0.88」', () async {
      final loan = await registerQaLoan();
      await loans.confirmDisbursement(loan.id);
      await loans.recordPayment(
        loanId: loan.id,
        amountCents: parseAmountToCents('8884')!,
        paidAt: DateTime.now(),
      );

      final first = (await loans.scheduleFor(loan.id)).first;
      expect(first.status, 'partial');
      expect(first.interestPaidCents, 100000, reason: '瀑布：利息先收滿');
      expect(first.principalPaidCents, 788400);

      // 差額小於 1 元，舊版顯示規則會把它變成 0 而被使用者忽略。
      expect(first.shortfallCents, 88);
      expect(formatMoney(first.shortfallCents), 'NT\$0.88');
      expect(formatMoney(first.paidCents), 'NT\$8,884.00');

      // 對話框下一次會帶入剩下的 88 分，不必使用者自己算。
      final suggestion = await loans.paymentSuggestion(loan.id);
      expect(suggestion.currentDueCents, 88);
      expect(centsToInput(88), '0.88');
    });

    test('第 8 步：用「一次結清」金額付清，狀態轉 SETTLED、待收歸零', () async {
      final loan = await registerQaLoan();
      await loans.confirmDisbursement(loan.id);
      final suggestion = await loans.paymentSuggestion(loan.id);
      expect(suggestion.payoffCents, 10661853);
      expect(formatMoney(suggestion.payoffCents), 'NT\$106,618.53');

      await loans.recordPayment(
        loanId: loan.id,
        amountCents: suggestion.payoffCents,
        paidAt: DateTime.now(),
      );

      final after = await loans.scheduleFor(loan.id);
      for (final item in after) {
        expect(item.shortfallCents, 0, reason: '第 ${item.periodNumber} 期');
      }
      expect((await loans.findById(loan.id))!.status, 'settled');

      final summary = await loans.replaySummary(loan.id);
      expect(summary.principalReceivedCents, 10000000, reason: '已收本金＝原始本金');
      expect(summary.interestReceivedCents, 661853, reason: '全期利息');
      expect(summary.outstandingPrincipalCents, 0);

      final snapshot = await dashboard.compute();
      expect(snapshot.totalReceivableCents, 0, reason: '結清後才可以是 0');
      expect(
        formatMoneyRounded(snapshot.totalInterestReceivedCents),
        'NT\$6,619',
      );
      expect(snapshot.totalDisbursedCents, 10000000, reason: '撥出去就是撥出去了');
      expect(snapshot.totalOverdueCents, 0);
    });

    test('第 9 步：撥款日選 70 天前，第 1、2 期立刻逾期共 NT\$35,625', () async {
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
      // UI 的「確認撥款」對話框現在可以選過去的日期，走的就是這條路徑。
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
      expect(formatMoneyRounded(snapshot.totalOverdueCents), 'NT\$35,625');
      expect(formatMoney(snapshot.totalOverdueCents), 'NT\$35,624.99');
      expect(snapshot.totalOutstandingPrincipalCents, 10000000);
      expect(snapshot.totalUnpaidInterestCents, 437500);

      // 逾期合計可以一鍵帶入，不必自己加兩期。
      final suggestion = await loans.paymentSuggestion(loan.id);
      expect(suggestion.overdueCents, 3562499);
    });

    test('第 10 步（接續第 1～8 步）：載入範例資料後的看板合計', () async {
      final loan = await registerQaLoan();
      await loans.confirmDisbursement(loan.id);
      final payoff = (await loans.paymentSuggestion(loan.id)).payoffCents;
      await loans.recordPayment(
        loanId: loan.id,
        amountCents: payoff,
        paidAt: DateTime.now(),
      );
      expect((await loans.findById(loan.id))!.status, 'settled');

      // 範例借款人的身分證必須與 MANUAL-QA 第 2 步使用的 A123456789 不同，
      // 否則查重會擋下、整個載入中途失敗。
      await seedDemoData(
        borrowers: BorrowerRepository(db, PiiCodec.fromPassphrase('qa')),
        loans: loans,
      );
      expect(await loans.listAll(), hasLength(3));

      final snapshot = await dashboard.compute();
      // 累計撥款 = 已結清的 10 萬 + 範例的 20 萬 + 10 萬。
      expect(formatMoneyRounded(snapshot.totalDisbursedCents), 'NT\$400,000');
      // 在貸本金只算沒收回來的：結清那筆已歸零。
      expect(
        snapshot.totalOutstandingPrincipalCents,
        20000000 - 1559509 + 10000000,
      );
      expect(formatMoneyRounded(snapshot.totalOverdueCents), 'NT\$35,625');
      expect(
        snapshot.totalReceivableCents,
        snapshot.totalOutstandingPrincipalCents +
            snapshot.totalUnpaidInterestCents,
      );
    });
  });
}
