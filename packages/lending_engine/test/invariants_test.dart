import 'package:lending_engine/lending_engine.dart';
import 'package:test/test.dart';

void main() {
  group('跨方法不變式（見 docs/interest-rules.md §7）', () {
    final principals = [1, 999999, 1000000, 12345601, 87654321];
    final rateBpsList = [0, 1, 50, 100, 275, 1999];
    final tenors = [1, 2, 3, 7, 12, 24, 36];

    for (final method in RepaymentMethod.values) {
      for (final principal in principals) {
        for (final rateBps in rateBpsList) {
          for (final tenor in tenors) {
            test(
              '$method P=$principal rateBps=$rateBps n=$tenor：'
              'Σprincipal==P 且末期餘額==0',
              () {
                final terms = LoanTerms(
                  principalCents: principal,
                  method: method,
                  rateSpec: RateSpec(
                    rateType: RateType.monthly,
                    rateBps: rateBps,
                    dayCount: DayCount.thirty360,
                  ),
                  tenorPeriods: tenor,
                  disbursedAt: DateTime(2026, 1, 1),
                );
                final result = generateSchedule(terms);

                expect(result.totalPrincipalCents, principal);
                expect(result.finalBalanceCents, 0);
                for (final item in result.items) {
                  expect(item.principalCents, greaterThanOrEqualTo(0));
                  expect(item.interestCents, greaterThanOrEqualTo(0));
                  expect(item.closingBalanceCents, greaterThanOrEqualTo(0));
                }
              },
            );
          }
        }
      }
    }

    test('BULLET 到期天數 = tenorPeriods * periodDays', () {
      final terms = LoanTerms(
        principalCents: 5000000,
        method: RepaymentMethod.bullet,
        rateSpec: const RateSpec(
          rateType: RateType.daily,
          rateBps: 5,
          dayCount: DayCount.act365,
          periodDays: 1,
        ),
        tenorPeriods: 45,
        disbursedAt: DateTime(2026, 3, 1),
      );
      final result = generateSchedule(terms);
      expect(result.items.single.dueDate,
          DateTime(2026, 3, 1).add(const Duration(days: 45)));
    });

    test('EMI 每期到期日間距等於 periodDays', () {
      final terms = LoanTerms(
        principalCents: 1000000,
        method: RepaymentMethod.emi,
        rateSpec: const RateSpec(
          rateType: RateType.monthly,
          rateBps: 100,
          dayCount: DayCount.thirty360,
          periodDays: 30,
        ),
        tenorPeriods: 6,
        disbursedAt: DateTime(2026, 1, 1),
      );
      final result = generateSchedule(terms);
      for (var i = 1; i < result.items.length; i++) {
        final diff = result.items[i].dueDate
            .difference(result.items[i - 1].dueDate)
            .inDays;
        expect(diff, 30);
      }
    });
  });
}
