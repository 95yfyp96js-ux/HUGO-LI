// 金額顯示與輸入規則的唯一鎖。
//
// 這裡失敗＝畫面上的金額規則被改動了，MANUAL-QA.md 的預期數字必須一起檢查。
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/widgets/format.dart';

void main() {
  group('formatMoney（精確到分，可操作金額一律用它）', () {
    test('Fixture A 第 1 期應繳：888,488 分顯示為 NT\$8,884.88', () {
      // 這正是「照畫面繳款會短少 88 分」的源頭。舊版顯示 NT$8,884，
      // 使用者照著繳就少 88 分；現在畫面直接給到分。
      expect(formatMoney(888488), 'NT\$8,884.88');
    });

    test('小於 1 元的差額看得見', () {
      expect(formatMoney(88), 'NT\$0.88');
      expect(formatMoney(1), 'NT\$0.01');
      expect(formatMoney(12), 'NT\$0.12');
    });

    test('整數元補足兩位小數', () {
      expect(formatMoney(10000000), 'NT\$100,000.00');
      expect(formatMoney(0), 'NT\$0.00');
    });

    test('負數保留符號（沖正／溢繳調整分錄會出現）', () {
      expect(formatMoney(-888488), '-NT\$8,884.88');
    });
  });

  group('formatMoneyRounded（看板概覽，規則寫死 ROUND_HALF_UP）', () {
    test('0.5 分以上進位、以下捨去', () {
      expect(formatMoneyRounded(888488), 'NT\$8,885', reason: '.88 進位');
      expect(formatMoneyRounded(888400), 'NT\$8,884', reason: '.00 不動');
      expect(
        formatMoneyRounded(888450),
        'NT\$8,885',
        reason: '.50 進位（half-up）',
      );
      expect(formatMoneyRounded(888449), 'NT\$8,884', reason: '.49 捨去');
    });

    test('看板實際會出現的數字', () {
      expect(formatMoneyRounded(3562499), 'NT\$35,625');
      expect(formatMoneyRounded(661853), 'NT\$6,619');
      expect(formatMoneyRounded(10000000), 'NT\$100,000');
      expect(formatMoneyRounded(0), 'NT\$0');
    });

    test('負數也走同一套規則', () {
      expect(formatMoneyRounded(-888488), '-NT\$8,885');
    });
  });

  group('parseAmountToCents（輸入元 → 分，全程不經過 double）', () {
    test('小數兩位精確轉換', () {
      expect(parseAmountToCents('8884.88'), 888488);
      // double 版的 8884.88 * 100 是 888487.9999…，截斷會少 1 分。
      expect((8884.88 * 100).toInt(), isNot(888488));
    });

    test('接受整數、一位小數、千分位逗號', () {
      expect(parseAmountToCents('8884'), 888400);
      expect(parseAmountToCents('8884.8'), 888480);
      expect(parseAmountToCents('8,884.88'), 888488);
      expect(parseAmountToCents('  100  '), 10000);
    });

    test('格式不合一律回 null，不自行猜測', () {
      expect(parseAmountToCents(''), isNull);
      expect(parseAmountToCents('abc'), isNull);
      expect(parseAmountToCents('-100'), isNull);
      expect(parseAmountToCents('88.888'), isNull, reason: '超過兩位小數');
      expect(parseAmountToCents('8.8.8'), isNull);
    });
  });

  group('centsToInput（分 → 可直接填回輸入框的元字串）', () {
    test('往返轉換不失真', () {
      for (final cents in [888488, 100, 88, 10000000, 9773353, 1]) {
        expect(
          parseAmountToCents(centsToInput(cents)),
          cents,
          reason: '$cents',
        );
      }
    });

    test('整數元不補小數點', () {
      expect(centsToInput(10000), '100');
      expect(centsToInput(888488), '8884.88');
      expect(centsToInput(888480), '8884.80');
    });
  });
}
