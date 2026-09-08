import 'package:meta/meta.dart';

/// 分錄類型。除 [LedgerEntryType.adjustment] 外，一律不可為負金額
/// （沖正一律用調整分錄，見 docs/interest-rules.md 不變式 §3）。
enum LedgerEntryType {
  /// 撥款（貸款總額計算基礎）。
  disbursement,

  /// 日結應計利息（未出帳）。
  accrual,

  /// 收款分配 — 罰息。
  penalty,

  /// 收款分配 — 費用。
  fee,

  /// 收款分配 — 利息（含出帳應計利息）。
  interest,

  /// 收款分配 — 本金。
  principal,

  /// 調整（沖正）：修正已入帳分錄，可為負數。
  adjustment,

  /// 減免（WAIVED 期別）。
  waiver,
}

/// 一筆分錄。**Append-only**：本套件的公開 API 中沒有任何修改或刪除既有
/// [LedgerEntry] 的方法，只能透過 [LedgerBook.append] 新增。
@immutable
class LedgerEntry {
  LedgerEntry({
    required this.id,
    required this.loanId,
    required this.type,
    required this.amountCents,
    required this.postedAt,
    this.relatedPeriodNumber,
    this.note,
  }) : assert(
          type == LedgerEntryType.adjustment || amountCents >= 0,
          '$type 分錄金額不可為負（沖正請用 LedgerEntryType.adjustment）',
        );

  final String id;
  final String loanId;
  final LedgerEntryType type;

  /// 分錄金額（分）。除 [LedgerEntryType.adjustment] 外恆為非負。
  final int amountCents;
  final DateTime postedAt;

  /// 對應的還款期別（若適用）。
  final int? relatedPeriodNumber;
  final String? note;

  @override
  String toString() =>
      'LedgerEntry(id=$id loan=$loanId type=$type amount=$amountCents '
      'postedAt=$postedAt period=$relatedPeriodNumber)';
}
