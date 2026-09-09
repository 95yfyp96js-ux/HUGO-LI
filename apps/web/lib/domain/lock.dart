import 'package:sqlite3/sqlite3.dart';

import '../money.dart';
import 'settlement.dart' show SettlementRejected;

/// 鎖帳（docs/BOSS-SPEC.md F）。
///
/// 老闆認證某個營業日之後，那一天就定案了。定案的意義只有在「**之後任何人都
/// 改不動它**」時才成立，所以這個檢查放在每一條寫入路徑的最前面，而不是只把
/// 按鈕藏起來。
///
/// 擋的範圍是「entryDate ≤ 最後一個已認證的營業日」——不只擋當天，也擋補登到
/// 更早的日子：往回補一筆，會改掉那天之後每一天的期初五格，等於把已經認證過
/// 的日結一起改了。
class LockGuard {
  LockGuard(this.db);

  final Database db;

  /// 最後一個已認證的營業日；沒有就回 null。
  DateTime? lastCertifiedDate() {
    final rows = db.select(
      'SELECT MAX(business_date) AS d FROM daily_closes '
      'WHERE certified_at IS NOT NULL',
    );
    final value = rows.first['d'];
    return value == null ? null : parseDate(value as String);
  }

  bool isLocked(DateTime entryDate) {
    final DateTime? last = lastCertifiedDate();
    if (last == null) return false;
    return !dateOnly(entryDate).isAfter(last);
  }

  void assertOpen(DateTime entryDate) {
    final DateTime? last = lastCertifiedDate();
    if (last == null) return;
    if (dateOnly(entryDate).isAfter(last)) return;
    throw SettlementRejected(
      '${formatDate(entryDate)} 這一天（含之前）已經由老闆認證鎖帳，不能再寫入。'
      '最後認證日是 ${formatDate(last)}。'
      '要更正已認證的帳，只能開更正單（本版尚未提供，見 docs/BOSS-SPEC.md F-2）。',
    );
  }
}
