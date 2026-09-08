import 'package:intl/intl.dart';

final NumberFormat _grouping = NumberFormat.decimalPattern('zh_Hant');

// 金額顯示規則（唯一來源，由 test/format_test.dart 鎖住）
//
// 帳務內部一律是整數「分」。畫面上只有兩種合法呈現方式：
//
// * formatMoney：**精確到分**，永遠兩位小數。凡是使用者可能照著操作的
//   金額（應繳、差額、餘額、逐期本息）一律用這個。截去分會讓人繳出對不上
//   的金額，帳就不平了。
// * formatMoneyRounded：捨去到整元，規則寫死為 ROUND_HALF_UP
//   （0.5 分進位）。只用在看板的四張大數字卡，因為那是概覽、不是可操作金額。
//
// 沒有第三種。要新增顯示位置時，先問「使用者會不會照這個數字輸入？」
// 會 → formatMoney；不會且空間吃緊 → formatMoneyRounded。

/// 精確金額：`NT$8,884.88`。負數前綴 `-`。
String formatMoney(int cents) {
  final String sign = cents < 0 ? '-' : '';
  final int abs = cents.abs();
  final String dollars = _grouping.format(abs ~/ 100);
  final String fraction = (abs % 100).toString().padLeft(2, '0');
  return '${sign}NT\$$dollars.$fraction';
}

/// 整元金額（ROUND_HALF_UP）：`NT$8,885`。只給看板概覽用。
String formatMoneyRounded(int cents) {
  final String sign = cents < 0 ? '-' : '';
  final int abs = cents.abs();
  final int dollars = (abs + 50) ~/ 100; // +50 分＝四捨五入到元
  return '${sign}NT\$${_grouping.format(dollars)}';
}

/// 使用者輸入的元字串 → 分。支援 `8884`、`8884.8`、`8884.88`、`8,884.88`。
///
/// 全程用字串拆解，**不經過 double**：`8884.88 * 100` 在浮點數下是
/// 888487.9999…，直接截斷就會少 1 分。格式不合或為負一律回 `null`，
/// 由呼叫端顯示錯誤，不要自行猜測使用者的意思。
int? parseAmountToCents(String input) {
  final String text = input.trim().replaceAll(',', '').replaceAll('，', '');
  if (text.isEmpty) return null;
  final RegExpMatch? match = RegExp(r'^(\d+)(?:\.(\d{1,2}))?$')
      .firstMatch(text);
  if (match == null) return null;
  final int dollars = int.parse(match.group(1)!);
  final String fraction = (match.group(2) ?? '').padRight(2, '0');
  return dollars * 100 + int.parse(fraction);
}

/// 分 → 可直接填回輸入框的元字串（`888488` → `8884.88`，`10000` → `100`）。
/// 整數元時不補 `.00`，少一個讓人誤刪的小數點。
String centsToInput(int cents) {
  final int abs = cents.abs();
  final String sign = cents < 0 ? '-' : '';
  final int fraction = abs % 100;
  if (fraction == 0) return '$sign${abs ~/ 100}';
  return '$sign${abs ~/ 100}.${fraction.toString().padLeft(2, '0')}';
}

String formatDate(DateTime date) =>
    '${date.year}/${date.month.toString().padLeft(2, '0')}/${date.day.toString().padLeft(2, '0')}';
