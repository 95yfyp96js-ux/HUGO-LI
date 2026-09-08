import 'package:decimal/decimal.dart';
import 'package:lending_engine/lending_engine.dart';
import 'package:test/test.dart';

void main() {
  group('RateSpec.ratePerPeriod', () {
    test('MONTHLY：直接使用月利率', () {
      const spec = RateSpec(
        rateType: RateType.monthly,
        rateBps: 250,
        dayCount: DayCount.thirty360,
      );
      expect(spec.ratePerPeriod(), Decimal.parse('0.025'));
    });

    test('PERIOD：直接使用輸入期利率', () {
      const spec = RateSpec(
        rateType: RateType.period,
        rateBps: 250,
        dayCount: DayCount.act365,
        periodDays: 45,
      );
      expect(spec.ratePerPeriod(), Decimal.parse('0.025'));
    });

    test('DAILY：日利率 * 實際天數', () {
      const spec = RateSpec(
        rateType: RateType.daily,
        rateBps: 10,
        dayCount: DayCount.act365,
      );
      expect(spec.ratePerPeriod(actualDays: 5), Decimal.parse('0.005'));
    });

    test('ANNUAL 分期模式：年利率 / 12', () {
      const spec = RateSpec(
        rateType: RateType.annual,
        rateBps: 1200,
        dayCount: DayCount.thirty360,
      );
      expect(spec.ratePerPeriod(), Decimal.parse('0.01'));
    });

    test('ANNUAL 按日模式：年利率 * 實際天數 / 365', () {
      const spec = RateSpec(
        rateType: RateType.annual,
        rateBps: 1200,
        dayCount: DayCount.act365,
      );
      expect(spec.ratePerPeriod(actualDays: 73), Decimal.parse('0.024'));
    });

    test('ANNUAL 按日模式：ACT_360', () {
      const spec = RateSpec(
        rateType: RateType.annual,
        rateBps: 1200,
        dayCount: DayCount.act360,
      );
      expect(spec.ratePerPeriod(actualDays: 90), Decimal.parse('0.03'));
    });
  });

  group('RateSpec.dailyRateBase / rateForDays', () {
    test('MONTHLY：月利率 / 30', () {
      const spec = RateSpec(
        rateType: RateType.monthly,
        rateBps: 300,
        dayCount: DayCount.thirty360,
      );
      expect(spec.dailyRateBase(), Decimal.parse('0.001'));
      expect(spec.rateForDays(10), Decimal.parse('0.01'));
    });

    test('PERIOD：期利率 / periodDays', () {
      const spec = RateSpec(
        rateType: RateType.period,
        rateBps: 500,
        dayCount: DayCount.act365,
        periodDays: 50,
      );
      expect(spec.dailyRateBase(), Decimal.parse('0.001'));
    });

    test('ANNUAL：年利率 / 365', () {
      const spec = RateSpec(
        rateType: RateType.annual,
        rateBps: 3650,
        dayCount: DayCount.act365,
      );
      expect(spec.dailyRateBase(), Decimal.parse('0.001'));
    });

    test('DAILY：本身即日利率', () {
      const spec = RateSpec(
        rateType: RateType.daily,
        rateBps: 20,
        dayCount: DayCount.act365,
      );
      expect(spec.dailyRateBase(), Decimal.parse('0.002'));
    });
  });
}
