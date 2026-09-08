import 'package:lending_engine/lending_engine.dart';
import 'package:test/test.dart';

void main() {
  group('日結應計利息', () {
    test('MONTHLY：日基礎利率 * 天數', () {
      const spec = RateSpec(
        rateType: RateType.monthly,
        rateBps: 300, // 3%/月，日基礎 = 0.001
        dayCount: DayCount.thirty360,
      );
      final cents = accrueInterestCents(
        balanceCents: 1000000,
        rateSpec: spec,
        from: DateTime(2026, 1, 1),
        to: DateTime(2026, 1, 11), // 10 天
      );
      // 1,000,000 * 0.001 * 10 = 10,000 分
      expect(cents, 10000);
    });

    test('天數為 0 或負時回傳 0', () {
      const spec = RateSpec(
        rateType: RateType.monthly,
        rateBps: 300,
        dayCount: DayCount.thirty360,
      );
      expect(
        accrueInterestCents(
          balanceCents: 1000000,
          rateSpec: spec,
          from: DateTime(2026, 1, 1),
          to: DateTime(2026, 1, 1),
        ),
        0,
      );
    });

    test('餘額為 0 時回傳 0', () {
      const spec = RateSpec(
        rateType: RateType.monthly,
        rateBps: 300,
        dayCount: DayCount.thirty360,
      );
      expect(
        accrueInterestCents(
          balanceCents: 0,
          rateSpec: spec,
          from: DateTime(2026, 1, 1),
          to: DateTime(2026, 1, 11),
        ),
        0,
      );
    });
  });

  group('逾期判定（寬限期）', () {
    test('未超過寬限期不算逾期', () {
      expect(
        isPastGrace(
          dueDate: DateTime(2026, 1, 1),
          graceDays: 3,
          asOf: DateTime(2026, 1, 4),
        ),
        isFalse,
      );
    });

    test('超過寬限期算逾期', () {
      expect(
        isPastGrace(
          dueDate: DateTime(2026, 1, 1),
          graceDays: 3,
          asOf: DateTime(2026, 1, 5),
        ),
        isTrue,
      );
    });
  });
}
