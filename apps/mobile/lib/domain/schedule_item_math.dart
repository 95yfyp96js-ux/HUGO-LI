import '../db/app_database.dart';

/// `schedule_items` 這一列的衍生金額（全部整數分）。集中在這裡，避免各畫面
/// 各自寫一次加減而算出不一樣的「尚差多少」。
extension ScheduleItemMath on ScheduleItem {
  /// 本期應繳（本金＋利息）。
  int get totalDueCents => principalCents + interestCents;

  /// 本期已沖銷金額（本金＋利息）。
  int get paidCents => interestPaidCents + principalPaidCents;

  /// 本期尚差多少才算繳清。可能小於 1 元（例如 88 分），畫面必須顯示得出來。
  int get shortfallCents {
    final int remaining = totalDueCents - paidCents;
    return remaining > 0 ? remaining : 0;
  }

  bool get isSettledPeriod =>
      status == 'paid' || status == 'prepaid' || status == 'waived';
}
