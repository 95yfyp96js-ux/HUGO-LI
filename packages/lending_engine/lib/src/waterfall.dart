import 'package:meta/meta.dart';

/// 入帳瀑布固定順序（見 docs/interest-rules.md §6）：
/// 1. PENALTY 2. FEE 3. INTEREST 4. PRINCIPAL 5. 溢收（視為提前還本）。
/// UI 不可調整此順序。

/// 一筆貸款在還款當下，各類別「應收未收」餘額。
@immutable
class OutstandingBuckets {
  const OutstandingBuckets({
    this.penaltyCents = 0,
    this.feeCents = 0,
    this.interestCents = 0,
    this.principalCents = 0,
  })  : assert(penaltyCents >= 0),
        assert(feeCents >= 0),
        assert(interestCents >= 0),
        assert(principalCents >= 0);

  final int penaltyCents;
  final int feeCents;
  final int interestCents;
  final int principalCents;
}

/// 一筆收款依瀑布順序分配後的結果。
@immutable
class WaterfallAllocation {
  const WaterfallAllocation({
    required this.penaltyCents,
    required this.feeCents,
    required this.interestCents,
    required this.principalCents,
    required this.overpaymentCents,
  });

  final int penaltyCents;
  final int feeCents;
  final int interestCents;
  final int principalCents;

  /// 溢收金額：超過所有應收（罰息＋費用＋利息＋本金）的部分，預設視為
  /// 提前還本，由呼叫端觸發 §4 的計畫重算。
  final int overpaymentCents;

  int get totalAppliedCents =>
      penaltyCents + feeCents + interestCents + principalCents;
}

/// 依固定瀑布順序分配一筆收款金額。純函式。
WaterfallAllocation applyWaterfall({
  required int paymentCents,
  required OutstandingBuckets outstanding,
}) {
  assert(paymentCents >= 0, 'paymentCents 不可為負');
  int remaining = paymentCents;

  int take(int owed) {
    final int amount = remaining < owed ? remaining : owed;
    remaining -= amount;
    return amount;
  }

  final int penalty = take(outstanding.penaltyCents);
  final int fee = take(outstanding.feeCents);
  final int interest = take(outstanding.interestCents);
  final int principal = take(outstanding.principalCents);

  return WaterfallAllocation(
    penaltyCents: penalty,
    feeCents: fee,
    interestCents: interest,
    principalCents: principal,
    overpaymentCents: remaining,
  );
}
