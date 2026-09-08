import 'package:lending_engine/lending_engine.dart';
import 'package:test/test.dart';

void main() {
  group('入帳瀑布', () {
    test('固定順序：罰息 → 費用 → 利息 → 本金', () {
      const outstanding = OutstandingBuckets(
        penaltyCents: 100,
        feeCents: 200,
        interestCents: 300,
        principalCents: 10000,
      );
      final result =
          applyWaterfall(paymentCents: 500, outstanding: outstanding);
      expect(result.penaltyCents, 100);
      expect(result.feeCents, 200);
      expect(result.interestCents, 200); // 只剩 200 可付利息
      expect(result.principalCents, 0);
      expect(result.overpaymentCents, 0);
    });

    test('全額繳清後仍有餘額 → 視為溢收（提前還本）', () {
      const outstanding = OutstandingBuckets(
        penaltyCents: 0,
        feeCents: 0,
        interestCents: 1000,
        principalCents: 5000,
      );
      final result =
          applyWaterfall(paymentCents: 8000, outstanding: outstanding);
      expect(result.interestCents, 1000);
      expect(result.principalCents, 5000);
      expect(result.overpaymentCents, 2000);
      expect(result.totalAppliedCents, 6000);
    });

    test('繳款金額為 0 時全部應收不變', () {
      const outstanding = OutstandingBuckets(
        penaltyCents: 10,
        feeCents: 20,
        interestCents: 30,
        principalCents: 40,
      );
      final result = applyWaterfall(paymentCents: 0, outstanding: outstanding);
      expect(result.penaltyCents, 0);
      expect(result.feeCents, 0);
      expect(result.interestCents, 0);
      expect(result.principalCents, 0);
      expect(result.overpaymentCents, 0);
    });

    test('無罰息無費用時直接沖利息與本金', () {
      const outstanding =
          OutstandingBuckets(interestCents: 500, principalCents: 5000);
      final result =
          applyWaterfall(paymentCents: 5500, outstanding: outstanding);
      expect(result.interestCents, 500);
      expect(result.principalCents, 5000);
      expect(result.overpaymentCents, 0);
    });
  });
}
