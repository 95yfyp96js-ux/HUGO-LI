// 金額規則（伺服器端唯一來源）。
import 'package:test/test.dart';
import 'package:web_ledger/money.dart';

void main() {
  test('可操作金額一律顯示到分', () {
    expect(formatMoney(888488), 'NT\$8,884.88');
    expect(formatMoney(88), 'NT\$0.88', reason: '差 88 分也要看得見');
    expect(formatMoney(10000000), 'NT\$100,000.00');
    expect(formatMoney(-100000), '-NT\$1,000.00');
  });

  test('概覽整元用 ROUND_HALF_UP', () {
    expect(formatMoneyRounded(888488), 'NT\$8,885');
    expect(formatMoneyRounded(888449), 'NT\$8,884');
    expect(formatMoneyRounded(50), 'NT\$1');
    expect(formatMoneyRounded(49), 'NT\$0');
  });

  test('輸入解析全程字串，8884.88 不會變成 888487', () {
    expect(parseAmountToCents('8884.88'), 888488);
    expect(parseAmountToCents('8,884.88'), 888488);
    expect(parseAmountToCents('8884.8'), 888480);
    expect(parseAmountToCents('8884'), 888400);
    expect(parseAmountToCents('0.01'), 1);
  });

  test('格式不合一律回 null，不猜使用者的意思', () {
    for (final bad in ['', ' ', 'abc', '-1', '1.234', '1..2', '８８']) {
      expect(parseAmountToCents(bad), isNull, reason: '「$bad」不該被接受');
    }
  });

  test('分 → 輸入框字串', () {
    expect(centsToInput(888488), '8884.88');
    expect(centsToInput(88), '0.88');
  });
}
