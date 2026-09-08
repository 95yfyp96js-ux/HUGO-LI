import 'package:lending_engine/lending_engine.dart';
import 'package:test/test.dart';

void main() {
  group('BULLET 一次本息', () {
    // Fixture D：P=3,000,000 分、ANNUAL、rate=12%、tenorPeriods=6、
    // periodDays=30（180 天）、ACT_365。
    test('Fixture D：到期一次還本付息，僅產生 1 期', () {
      final terms = LoanTerms(
        principalCents: 3000000,
        method: RepaymentMethod.bullet,
        rateSpec: const RateSpec(
          rateType: RateType.annual,
          rateBps: 1200,
          dayCount: DayCount.act365,
          periodDays: 30,
        ),
        tenorPeriods: 6,
        disbursedAt: DateTime(2026, 1, 1),
      );
      final result = generateSchedule(terms);

      expect(result.items, hasLength(1));
      final item = result.items.single;
      expect(item.openingBalanceCents, 3000000);
      expect(item.principalCents, 3000000);
      expect(item.interestCents, 177534);
      expect(item.closingBalanceCents, 0);
      expect(item.totalDueCents, 3177534);
      expect(item.dueDate, DateTime(2026, 1, 1).add(const Duration(days: 180)));

      expect(result.totalPrincipalCents, 3000000);
      expect(result.finalBalanceCents, 0);
    });
  });
}
