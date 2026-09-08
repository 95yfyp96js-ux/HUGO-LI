import 'package:lending_engine/lending_engine.dart';
import 'package:test/test.dart';

void main() {
  group('EPP 等額本金', () {
    // Fixture B：本金刻意選不整除的數字，驗證尾差全部落在末期。
    test('Fixture B：本金不整除時尾差落在末期', () {
      final terms = LoanTerms(
        principalCents: 10000007,
        method: RepaymentMethod.epp,
        rateSpec: const RateSpec(
          rateType: RateType.monthly,
          rateBps: 150,
          dayCount: DayCount.thirty360,
        ),
        tenorPeriods: 6,
        disbursedAt: DateTime(2026, 1, 1),
      );
      final result = generateSchedule(terms);

      const expected = [
        (
          opening: 10000007,
          principal: 1666667,
          interest: 150000,
          closing: 8333340
        ),
        (
          opening: 8333340,
          principal: 1666667,
          interest: 125000,
          closing: 6666673
        ),
        (
          opening: 6666673,
          principal: 1666667,
          interest: 100000,
          closing: 5000006
        ),
        (
          opening: 5000006,
          principal: 1666667,
          interest: 75000,
          closing: 3333339
        ),
        (
          opening: 3333339,
          principal: 1666667,
          interest: 50000,
          closing: 1666672
        ),
        (opening: 1666672, principal: 1666672, interest: 25000, closing: 0),
      ];

      for (var t = 0; t < 6; t++) {
        final item = result.items[t];
        final exp = expected[t];
        expect(item.openingBalanceCents, exp.opening,
            reason: 'period ${t + 1}');
        expect(item.principalCents, exp.principal, reason: 'period ${t + 1}');
        expect(item.interestCents, exp.interest, reason: 'period ${t + 1}');
        expect(item.closingBalanceCents, exp.closing,
            reason: 'period ${t + 1}');
      }

      // 前 5 期每期本金相同（floor(P/n)），第 6 期比其他期多 5 分（餘數）。
      expect(result.items[0].principalCents, result.items[4].principalCents);
      expect(
          result.items[5].principalCents - result.items[0].principalCents, 5);

      expect(result.totalPrincipalCents, 10000007);
      expect(result.finalBalanceCents, 0);

      // 利息應隨餘額遞減。
      for (var t = 1; t < 6; t++) {
        expect(result.items[t].interestCents,
            lessThan(result.items[t - 1].interestCents));
      }
    });
  });
}
