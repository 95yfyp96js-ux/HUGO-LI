// 黃金案例：整筆貸款的生命週期（計畫 → 逐期依瀑布沖銷 → 結清）。
//
// 既有的 emi/epp/io/bullet 測試鎖的是「計畫表逐期金額」，waterfall_test 鎖的是
// 「單筆收款如何分配」。這支測試補的是兩者中間那段：把一整份計畫表交給瀑布，
// 一期一期收款，驗證每一步的分配結果與剩餘本金，直到分毫不差地結清。
//
// 本檔的數字同時是 docs/MANUAL-QA.md 手動驗收腳本的預期值來源；改動引擎導致
// 這裡失敗時，MANUAL-QA.md 也必須跟著更新。
import 'package:lending_engine/lending_engine.dart';
import 'package:test/test.dart';

/// Fixture A（docs/interest-rules.md §8）：P=100,000 元、月利率 1%、12 期 EMI。
/// 也是 MANUAL-QA.md 使用的案例，因為它剛好是登記貸款表單的預設值。
LoanTerms _fixtureA() => LoanTerms(
      principalCents: 10000000,
      method: RepaymentMethod.emi,
      rateSpec: const RateSpec(
        rateType: RateType.monthly,
        rateBps: 100,
        dayCount: DayCount.thirty360,
      ),
      tenorPeriods: 12,
      disbursedAt: DateTime(2026, 1, 1),
    );

void main() {
  group('黃金案例：EMI 全生命週期逐期結清', () {
    test('每期都足額繳納時，12 期後本金收足、利息收足、餘額歸零', () {
      final schedule = generateSchedule(_fixtureA());

      int principalCollected = 0;
      int interestCollected = 0;
      int outstanding = schedule.items.first.openingBalanceCents;

      for (final item in schedule.items) {
        final allocation = applyWaterfall(
          paymentCents: item.totalDueCents,
          outstanding: OutstandingBuckets(
            interestCents: item.interestCents,
            principalCents: item.principalCents,
          ),
        );

        // 足額繳納：利息、本金皆全數沖銷，不應有溢收。
        expect(allocation.interestCents, item.interestCents,
            reason: '第 ${item.periodNumber} 期利息');
        expect(allocation.principalCents, item.principalCents,
            reason: '第 ${item.periodNumber} 期本金');
        expect(allocation.overpaymentCents, 0,
            reason: '第 ${item.periodNumber} 期不應有溢收');

        principalCollected += allocation.principalCents;
        interestCollected += allocation.interestCents;
        outstanding -= allocation.principalCents;

        // 每一期沖銷後的剩餘本金，必須等於計畫表上該期的期末餘額。
        expect(outstanding, item.closingBalanceCents,
            reason: '第 ${item.periodNumber} 期期末餘額');
      }

      expect(principalCollected, 10000000, reason: '已收本金＝原始本金');
      expect(interestCollected, 661853, reason: '全期利息合計');
      expect(outstanding, 0, reason: '結清後餘額必須為 0');
      expect(principalCollected + interestCollected, 10661853, reason: '總收款');
    });

    test('照畫面顯示金額（截去分）繳款會短少，第 1 期只能部分沖銷', () {
      // App 的 formatCents 把 888,488 分顯示為 NT$8,884，使用者照畫面輸入
      // 8,884 元＝888,400 分，比應繳少 88 分。這是 MANUAL-QA.md 第 6 步
      // 刻意驗的情境（也是已知的產品缺陷，見該文件「還不能封測」）。
      final schedule = generateSchedule(_fixtureA());
      final first = schedule.items.first;
      expect(first.totalDueCents, 888488);

      final displayedDollars = first.totalDueCents ~/ 100; // 8884
      final allocation = applyWaterfall(
        paymentCents: displayedDollars * 100,
        outstanding: OutstandingBuckets(
          interestCents: first.interestCents,
          principalCents: first.principalCents,
        ),
      );

      // 瀑布順序：利息先收滿，短少的落在本金。
      expect(allocation.interestCents, 100000);
      expect(allocation.principalCents, 788400);
      expect(first.principalCents - allocation.principalCents, 88,
          reason: '短少 88 分');
      expect(allocation.overpaymentCents, 0);
    });

    test('補繳差額後溢收會往下一期的利息沖銷（跨期串接）', () {
      final schedule = generateSchedule(_fixtureA());
      final first = schedule.items.first;
      final second = schedule.items[1];

      // 第 1 期還差 88 分，使用者補繳 1 元（100 分）。
      final topUp = applyWaterfall(
        paymentCents: 100,
        outstanding:
            const OutstandingBuckets(interestCents: 0, principalCents: 88),
      );
      expect(topUp.principalCents, 88);
      expect(topUp.overpaymentCents, 12, reason: '多出的 12 分往後期串接');

      // 溢收的 12 分進入第 2 期，依瀑布先沖利息。
      final next = applyWaterfall(
        paymentCents: topUp.overpaymentCents,
        outstanding: OutstandingBuckets(
          interestCents: second.interestCents,
          principalCents: second.principalCents,
        ),
      );
      expect(next.interestCents, 12);
      expect(next.principalCents, 0);
      expect(first.principalCents, 788488);
    });

    test('提前一次結清剩餘全部期別，收款總額與剩餘應繳完全相等', () {
      final schedule = generateSchedule(_fixtureA());

      // 第 1 期已繳清，其餘 11 期一次付清。
      final remaining = schedule.items.skip(1).fold<int>(
            0,
            (sum, item) => sum + item.totalDueCents,
          );
      expect(remaining, 10661853 - 888488);

      int pot = remaining;
      for (final item in schedule.items.skip(1)) {
        final allocation = applyWaterfall(
          paymentCents: pot,
          outstanding: OutstandingBuckets(
            interestCents: item.interestCents,
            principalCents: item.principalCents,
          ),
        );
        expect(allocation.interestCents, item.interestCents);
        expect(allocation.principalCents, item.principalCents);
        pot = allocation.overpaymentCents;
      }
      expect(pot, 0, reason: '最後一期沖完應剛好用罄，無溢收');
    });
  });

  group('黃金案例：EPP 逾期情境（MANUAL-QA 示範資料第 2 筆）', () {
    test('P=100,000 元、年利率 15%、6 期等額本金的前兩期金額', () {
      final schedule = generateSchedule(
        LoanTerms(
          principalCents: 10000000,
          method: RepaymentMethod.epp,
          rateSpec: const RateSpec(
            rateType: RateType.annual,
            rateBps: 1500,
            dayCount: DayCount.thirty360,
          ),
          tenorPeriods: 6,
          disbursedAt: DateTime(2026, 6, 30),
        ),
      );

      expect(schedule.items[0].principalCents, 1666666);
      expect(schedule.items[0].interestCents, 125000);
      expect(schedule.items[0].totalDueCents, 1791666);
      expect(schedule.items[1].totalDueCents, 1770833);

      // 看板「逾期」＝前兩期應繳合計（seed 示範資料刻意不繳款）。
      expect(
        schedule.items[0].totalDueCents + schedule.items[1].totalDueCents,
        3562499,
      );

      expect(schedule.totalPrincipalCents, 10000000);
      expect(schedule.finalBalanceCents, 0);
      // 末期吃尾差：比其他期多 4 分。
      expect(
          schedule.items[5].principalCents - schedule.items[0].principalCents,
          4);
    });
  });
}
