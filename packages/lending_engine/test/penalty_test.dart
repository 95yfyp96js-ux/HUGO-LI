// 罰息的兩個組成元件：寬限期判定（isPastGrace）與逾期期間的計息
// （accrueInterestCents 套用罰息率）。見 docs/interest-rules.md §5、§7。
//
// 這裡全部釘死數字。罰息是最容易「多算一天」「少算一天」的地方，只驗
// 「大於 0」等於沒驗。期望值由 Python decimal/Fraction 參考實作獨立算出：
// 日基礎利率 = trunc(bps/10000/365, 28 位小數)，逐日累乘後對分做四捨五入。
import 'package:lending_engine/lending_engine.dart';
import 'package:test/test.dart';

/// 預設罰息規格：年息 6%、ACT/365（見 docs/ASSUMPTIONS.md §4）。
const RateSpec penaltySpec = RateSpec(
  rateType: RateType.annual,
  rateBps: 600,
  dayCount: DayCount.act365,
);

void main() {
  group('isPastGrace：寬限期邊界', () {
    final due = DateTime(2026, 3, 1);

    test('到期日當天不算逾期', () {
      expect(isPastGrace(dueDate: due, graceDays: 3, asOf: due), isFalse);
    });

    test('寬限期最後一天（到期 + 3 天）仍不算逾期', () {
      expect(
        isPastGrace(
          dueDate: due,
          graceDays: 3,
          asOf: due.add(const Duration(days: 3)),
        ),
        isFalse,
        reason: '第 3 天結束前繳都算準時，這一天不能起算罰息',
      );
    });

    test('超過寬限期一秒就算逾期', () {
      expect(
        isPastGrace(
          dueDate: due,
          graceDays: 3,
          asOf: due.add(const Duration(days: 3, seconds: 1)),
        ),
        isTrue,
      );
    });

    test('寬限 0 天：到期日隔天才算逾期', () {
      expect(isPastGrace(dueDate: due, graceDays: 0, asOf: due), isFalse);
      expect(
        isPastGrace(
          dueDate: due,
          graceDays: 0,
          asOf: due.add(const Duration(days: 1)),
        ),
        isTrue,
      );
    });
  });

  group('罰息金額：固定數字', () {
    final graceEnd = DateTime(2026, 3, 4); // 到期 3/1 + 寬限 3 天

    test('逾期本息 50,000.00 元、30 天 → 246.58 元', () {
      expect(
        accrueInterestCents(
          balanceCents: 5000000,
          rateSpec: penaltySpec,
          from: graceEnd,
          to: graceEnd.add(const Duration(days: 30)),
        ),
        24658,
      );
    });

    test('逾期本息 17,666.66 元、87 天 → 252.66 元', () {
      expect(
        accrueInterestCents(
          balanceCents: 1766666,
          rateSpec: penaltySpec,
          from: graceEnd,
          to: graceEnd.add(const Duration(days: 87)),
        ),
        25266,
      );
    });

    test('逾期本息 17,499.99 元、57 天 → 163.97 元', () {
      expect(
        accrueInterestCents(
          balanceCents: 1749999,
          rateSpec: penaltySpec,
          from: graceEnd,
          to: graceEnd.add(const Duration(days: 57)),
        ),
        16397,
      );
    });

    test('逾期本息 17,333.33 元、27 天 → 76.93 元', () {
      expect(
        accrueInterestCents(
          balanceCents: 1733333,
          rateSpec: penaltySpec,
          from: graceEnd,
          to: graceEnd.add(const Duration(days: 27)),
        ),
        7693,
      );
    });

    test('三期分別計算後合計 493.56 元（不是拿總額乘最長天數）', () {
      final int p1 = accrueInterestCents(
        balanceCents: 1766666,
        rateSpec: penaltySpec,
        from: graceEnd,
        to: graceEnd.add(const Duration(days: 87)),
      );
      final int p2 = accrueInterestCents(
        balanceCents: 1749999,
        rateSpec: penaltySpec,
        from: graceEnd,
        to: graceEnd.add(const Duration(days: 57)),
      );
      final int p3 = accrueInterestCents(
        balanceCents: 1733333,
        rateSpec: penaltySpec,
        from: graceEnd,
        to: graceEnd.add(const Duration(days: 27)),
      );
      expect(p1 + p2 + p3, 49356);
    });

    test('罰息率 0 → 一毛都不能算', () {
      expect(
        accrueInterestCents(
          balanceCents: 1766666,
          rateSpec: const RateSpec(
            rateType: RateType.annual,
            rateBps: 0,
            dayCount: DayCount.act365,
          ),
          from: graceEnd,
          to: graceEnd.add(const Duration(days: 87)),
        ),
        0,
      );
    });

    test('尚未超過寬限期（天數 <= 0）→ 0，不可算成負數', () {
      expect(
        accrueInterestCents(
          balanceCents: 1766666,
          rateSpec: penaltySpec,
          from: graceEnd,
          to: graceEnd.subtract(const Duration(days: 3)),
        ),
        0,
      );
    });

    test('逾期金額已繳清（餘額 0）→ 0', () {
      expect(
        accrueInterestCents(
          balanceCents: 0,
          rateSpec: penaltySpec,
          from: graceEnd,
          to: graceEnd.add(const Duration(days: 87)),
        ),
        0,
      );
    });
  });
}
