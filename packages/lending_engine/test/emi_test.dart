import 'package:lending_engine/lending_engine.dart';
import 'package:test/test.dart';

void main() {
  group('EMI 等額本息', () {
    // Fixture A: docs/interest-rules.md §8 — P=10,000,000 分、MONTHLY、
    // rate=1%（100 bps）、n=12、THIRTY_360。期望值由 Python decimal
    // （ROUND_HALF_UP）依相同公式獨立算出。
    test('Fixture A：固定數字案例逐期核對', () {
      final terms = LoanTerms(
        principalCents: 10000000,
        method: RepaymentMethod.emi,
        rateSpec: const RateSpec(
          rateType: RateType.monthly,
          rateBps: 100,
          dayCount: DayCount.thirty360,
        ),
        tenorPeriods: 12,
        disbursedAt: DateTime(2026, 1, 1),
      );
      final result = generateSchedule(terms);
      expect(result.items, hasLength(12));

      const expected = [
        (
          opening: 10000000,
          principal: 788488,
          interest: 100000,
          closing: 9211512
        ),
        (
          opening: 9211512,
          principal: 796373,
          interest: 92115,
          closing: 8415139
        ),
        (
          opening: 8415139,
          principal: 804337,
          interest: 84151,
          closing: 7610802
        ),
        (
          opening: 7610802,
          principal: 812380,
          interest: 76108,
          closing: 6798422
        ),
        (
          opening: 6798422,
          principal: 820504,
          interest: 67984,
          closing: 5977918
        ),
        (
          opening: 5977918,
          principal: 828709,
          interest: 59779,
          closing: 5149209
        ),
        (
          opening: 5149209,
          principal: 836996,
          interest: 51492,
          closing: 4312213
        ),
        (
          opening: 4312213,
          principal: 845366,
          interest: 43122,
          closing: 3466847
        ),
        (
          opening: 3466847,
          principal: 853820,
          interest: 34668,
          closing: 2613027
        ),
        (
          opening: 2613027,
          principal: 862358,
          interest: 26130,
          closing: 1750669
        ),
        (opening: 1750669, principal: 870981, interest: 17507, closing: 879688),
        (opening: 879688, principal: 879688, interest: 8797, closing: 0),
      ];

      for (var t = 0; t < 12; t++) {
        final item = result.items[t];
        final exp = expected[t];
        expect(item.openingBalanceCents, exp.opening,
            reason: 'period ${t + 1} opening');
        expect(item.principalCents, exp.principal,
            reason: 'period ${t + 1} principal');
        expect(item.interestCents, exp.interest,
            reason: 'period ${t + 1} interest');
        expect(item.closingBalanceCents, exp.closing,
            reason: 'period ${t + 1} closing');
      }

      // 每期應繳總額（level payment）在第 1..11 期應固定為 888488 分。
      for (var t = 0; t < 11; t++) {
        expect(result.items[t].totalDueCents, 888488);
      }

      // 不變式 §7.1、§7.2
      expect(result.totalPrincipalCents, 10000000);
      expect(result.finalBalanceCents, 0);
    });

    // Fixture E：r=0 分支，退化為本金平均攤還。
    test('Fixture E：零利率退化為本金平均攤還', () {
      final terms = LoanTerms(
        principalCents: 1200000,
        method: RepaymentMethod.emi,
        rateSpec: const RateSpec(
          rateType: RateType.monthly,
          rateBps: 0,
          dayCount: DayCount.thirty360,
        ),
        tenorPeriods: 12,
        disbursedAt: DateTime(2026, 1, 1),
      );
      final result = generateSchedule(terms);
      for (final item in result.items) {
        expect(item.principalCents, 100000);
        expect(item.interestCents, 0);
      }
      expect(result.totalPrincipalCents, 1200000);
      expect(result.finalBalanceCents, 0);
    });

    test('計畫表可重算（純函式、無副作用）', () {
      final terms = LoanTerms(
        principalCents: 10000000,
        method: RepaymentMethod.emi,
        rateSpec: const RateSpec(
          rateType: RateType.monthly,
          rateBps: 100,
          dayCount: DayCount.thirty360,
        ),
        tenorPeriods: 12,
        disbursedAt: DateTime(2026, 1, 1),
      );
      final a = generateSchedule(terms);
      final b = generateSchedule(terms);
      for (var i = 0; i < a.items.length; i++) {
        expect(a.items[i].principalCents, b.items[i].principalCents);
        expect(a.items[i].interestCents, b.items[i].interestCents);
      }
    });
  });
}
