import 'package:lending_engine/lending_engine.dart';
import 'package:test/test.dart';

void main() {
  group('IO 先息後本', () {
    // Fixture C：P=5,000,000 分、MONTHLY、rate=2%、n=4。
    test('Fixture C：前 n-1 期只付息，末期還本金＋當期息', () {
      final terms = LoanTerms(
        principalCents: 5000000,
        method: RepaymentMethod.io,
        rateSpec: const RateSpec(
          rateType: RateType.monthly,
          rateBps: 200,
          dayCount: DayCount.thirty360,
        ),
        tenorPeriods: 4,
        disbursedAt: DateTime(2026, 1, 1),
      );
      final result = generateSchedule(terms);

      for (var t = 0; t < 3; t++) {
        expect(result.items[t].principalCents, 0, reason: 'period ${t + 1}');
        expect(result.items[t].interestCents, 100000,
            reason: 'period ${t + 1}');
        expect(result.items[t].closingBalanceCents, 5000000,
            reason: 'period ${t + 1}');
      }

      final last = result.items[3];
      expect(last.principalCents, 5000000);
      expect(last.interestCents, 100000);
      expect(last.closingBalanceCents, 0);
      expect(last.totalDueCents, 5100000);

      expect(result.totalPrincipalCents, 5000000);
      expect(result.finalBalanceCents, 0);
    });
  });
}
