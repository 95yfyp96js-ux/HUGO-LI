import 'package:decimal/decimal.dart';

import 'money.dart';

/// 利率類型（見 docs/interest-rules.md §2）。
enum RateType { monthly, annual, daily, period }

/// 日數基礎（day-count convention）。
enum DayCount { thirty360, act365, act360 }

/// 一筆貸款鎖定的利率／天數規則（連同建檔當下的 `ruleVersion`）。
class RateSpec {
  const RateSpec({
    required this.rateType,
    required this.rateBps,
    required this.dayCount,
    this.periodDays = 30,
  })  : assert(rateBps >= 0, 'rateBps 不可為負'),
        assert(periodDays > 0, 'periodDays 必須大於 0');

  /// 利率，基點（1% = 100 bps），單位依 [rateType]。
  final int rateBps;
  final RateType rateType;
  final DayCount dayCount;

  /// 每期天數，預設 30（見 docs/interest-rules.md §1.1）。
  final int periodDays;

  Decimal get _rateFraction =>
      divD(Decimal.fromInt(rateBps), Decimal.fromInt(10000));

  /// 每一般還款期（EMI/EPP/IO 使用）的期間利率 `r`。
  ///
  /// [actualDays] 僅在 `rateType == daily` 或
  /// `rateType == annual && dayCount != thirty360`（按日模式）時需要，
  /// 代表該期實際天數；未提供時退回 [periodDays]。
  Decimal ratePerPeriod({int? actualDays}) {
    switch (rateType) {
      case RateType.monthly:
      case RateType.period:
        return _rateFraction;
      case RateType.annual:
        if (dayCount == DayCount.thirty360) {
          // 分期模式：年利率 / 12。
          return divD(_rateFraction, Decimal.fromInt(12));
        }
        final int days = actualDays ?? periodDays;
        final int denom = dayCount == DayCount.act360 ? 360 : 365;
        return divD(
            _rateFraction * Decimal.fromInt(days), Decimal.fromInt(denom));
      case RateType.daily:
        final int days = actualDays ?? periodDays;
        return _rateFraction * Decimal.fromInt(days);
    }
  }

  /// 換算為「每日基礎利率」，供日結（daily accrual）與 BULLET 到期利率使用。
  Decimal dailyRateBase() {
    switch (rateType) {
      case RateType.monthly:
        return divD(_rateFraction, Decimal.fromInt(30));
      case RateType.period:
        return divD(_rateFraction, Decimal.fromInt(periodDays));
      case RateType.annual:
        final int denom = dayCount == DayCount.act360 ? 360 : 365;
        return divD(_rateFraction, Decimal.fromInt(denom));
      case RateType.daily:
        return _rateFraction;
    }
  }

  /// 給定天數（如 BULLET 到期天數，或日結補計息天數）的累計利率。
  Decimal rateForDays(int days) => dailyRateBase() * Decimal.fromInt(days);
}
