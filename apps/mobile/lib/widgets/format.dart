import 'package:intl/intl.dart';

final NumberFormat _twd = NumberFormat.decimalPattern('zh_Hant');

/// 分 -> `NT$1,234` 顯示字串（無條件捨去分至元顯示；帳務內部仍以分為準）。
String formatCents(int cents) {
  final sign = cents < 0 ? '-' : '';
  final dollars = cents.abs() ~/ 100;
  return '${sign}NT\$${_twd.format(dollars)}';
}

String formatDate(DateTime date) =>
    '${date.year}/${date.month.toString().padLeft(2, '0')}/${date.day.toString().padLeft(2, '0')}';
