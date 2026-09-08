import 'money.dart';
import 'rate.dart';

/// 日結：從 [from]（不含）到 [to]（含）逐日以日基礎利率對 [balanceCents]
/// 計提應計利息（見 docs/interest-rules.md §5）。回傳應計利息（分）。
///
/// 純函式：只計算金額，不寫入分錄／不變更狀態，由呼叫端（repository 層）
/// 寫入 `ACCRUAL` 分錄。
int accrueInterestCents({
  required int balanceCents,
  required RateSpec rateSpec,
  required DateTime from,
  required DateTime to,
}) {
  final int days = to.difference(from).inDays;
  if (days <= 0 || balanceCents <= 0) return 0;
  final r = rateSpec.rateForDays(days);
  return roundHalfUpToCents(centsToDecimal(balanceCents) * r);
}

/// 逾期判定（見 docs/interest-rules.md §5、docs/state-machines.md §2）：
/// `dueDate + graceDays < asOf` 且該期尚未全額繳清。
bool isPastGrace({
  required DateTime dueDate,
  required int graceDays,
  required DateTime asOf,
}) {
  final DateTime graceEnd = dueDate.add(Duration(days: graceDays));
  return asOf.isAfter(graceEnd);
}
