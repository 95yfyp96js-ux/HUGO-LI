/// 金額規則（伺服器端唯一來源）。
///
/// 帳務內部一律整數「分」。**前端不做任何金額運算**：畫面上看到的每一個
/// 數字都是這裡格式化好、當成字串送出去的。瀏覽器只負責顯示。
library;

/// 精確金額：`NT$8,884.88`。可操作金額一律用這個。
String formatMoney(int cents) {
  final String sign = cents < 0 ? '-' : '';
  final int abs = cents.abs();
  return '${sign}NT\$${_group(abs ~/ 100)}.${(abs % 100).toString().padLeft(2, '0')}';
}

/// 整元金額（ROUND_HALF_UP）：`NT$8,885`。只給活盤概覽的大數字用。
String formatMoneyRounded(int cents) {
  final String sign = cents < 0 ? '-' : '';
  final int abs = cents.abs();
  return '${sign}NT\$${_group((abs + 50) ~/ 100)}';
}

/// 使用者輸入的元字串 → 分。**全程字串拆解，不經過 double**
/// （`8884.88 * 100` 在浮點下是 888487.99…，截斷會少 1 分）。
/// 格式不合或為負一律回 null，由呼叫端顯示錯誤，不猜使用者的意思。
int? parseAmountToCents(String input) {
  final String text = input.trim().replaceAll(',', '');
  final match = RegExp(r'^(\d+)(?:\.(\d{1,2}))?$').firstMatch(text);
  if (match == null) return null;
  final int dollars = int.parse(match.group(1)!);
  final String frac = (match.group(2) ?? '').padRight(2, '0');
  return dollars * 100 + int.parse(frac);
}

/// 分 → 可直接填回輸入框的元字串：`888488` → `8884.88`。
String centsToInput(int cents) {
  final int abs = cents.abs();
  return '${cents < 0 ? '-' : ''}${abs ~/ 100}.${(abs % 100).toString().padLeft(2, '0')}';
}

String _group(int value) {
  final String digits = value.toString();
  final buffer = StringBuffer();
  for (int i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write(',');
    buffer.write(digits[i]);
  }
  return buffer.toString();
}

/// 只保留日期（丟掉時分秒），日結與到期日比較都用這個。
DateTime dateOnly(DateTime value) =>
    DateTime(value.year, value.month, value.day);

String formatDate(DateTime value) =>
    '${value.year}-${value.month.toString().padLeft(2, '0')}-'
    '${value.day.toString().padLeft(2, '0')}';

DateTime parseDate(String value) => DateTime.parse(value);
