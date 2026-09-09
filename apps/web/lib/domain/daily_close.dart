import 'dart:convert';

import 'package:sqlite3/sqlite3.dart';

import '../db/schema.dart';
import '../money.dart';
import 'board.dart';
import 'settlement.dart' show SettlementRejected;

/// 日結一張表（docs/BOSS-SPEC.md E、F）。
///
/// 四關全部只有老闆能按：核定 → （系統做核銷檢查）→ 確認 → 認證。
/// 認證後那一天鎖定，任何寫入都被 [LockGuard] 擋掉。
class DailyMovements {
  const DailyMovements({
    required this.disbursed,
    required this.loanCollected,
    required this.checkCashPaid,
    required this.checkCashed,
    required this.checkBounced,
    required this.heldFaceIn,
    required this.heldFaceOut,
  });

  /// 放款（撥付金額）。
  final int disbursed;

  /// 收款（借款核銷金額，含罰息，不含溢繳）。
  final int loanCollected;

  /// 收票實付（現金流出）。
  final int checkCashPaid;

  /// 兌現（實收）。
  final int checkCashed;

  /// 退票（轉追償金額）。
  final int checkBounced;

  /// 格 2 當天增加的票面（收票）。
  final int heldFaceIn;

  /// 格 2 當天減少的票面（兌現收到的 + 退票時剩下的未收票面）。
  final int heldFaceOut;

  Map<String, dynamic> toJson() => {
    'disbursed': disbursed,
    'loan_collected': loanCollected,
    'check_cash_paid': checkCashPaid,
    'check_cashed': checkCashed,
    'check_bounced': checkBounced,
    'held_face_in': heldFaceIn,
    'held_face_out': heldFaceOut,
  };

  static DailyMovements fromJson(Map<String, dynamic> j) => DailyMovements(
    disbursed: j['disbursed'] as int,
    loanCollected: j['loan_collected'] as int,
    checkCashPaid: j['check_cash_paid'] as int,
    checkCashed: j['check_cashed'] as int,
    checkBounced: j['check_bounced'] as int,
    heldFaceIn: j['held_face_in'] as int,
    heldFaceOut: j['held_face_out'] as int,
  );
}

/// 一條不能認證的理由。空清單才准按認證。
class Blocker {
  const Blocker(this.reason, {this.detail = ''});
  final String reason;
  final String detail;
}

class DailyCloseSheet {
  const DailyCloseSheet({
    required this.businessDate,
    required this.opening,
    required this.movements,
    required this.closing,
    required this.imbalances,
    required this.unreconciled,
    required this.blockers,
    required this.reviewedBy,
    required this.confirmedBy,
    required this.certifiedBy,
  });

  final DateTime businessDate;
  final FiveBoxes opening;
  final DailyMovements movements;
  final FiveBoxes closing;
  final List<Imbalance> imbalances;
  final List<UnreconciledItem> unreconciled;

  /// 不能認證的理由。**非空就不准按認證**（不是提醒，是擋）。
  final List<Blocker> blockers;

  final String? reviewedBy;
  final String? confirmedBy;
  final String? certifiedBy;

  bool get isReviewed => reviewedBy != null;
  bool get isConfirmed => confirmedBy != null;
  bool get isCertified => certifiedBy != null;
  bool get canCertify => isConfirmed && blockers.isEmpty && !isCertified;
}

class DailyCloseService {
  DailyCloseService(this.db) : _board = BoardService(db);

  final Database db;
  final BoardService _board;

  /// 組出某一天的日結表。純讀，不寫入。
  DailyCloseSheet sheet(DateTime date) {
    final DateTime d = dateOnly(date);
    final DateTime prev = d.subtract(const Duration(days: 1));

    final FiveBoxes opening = _board.replayAsOf(prev);
    final FiveBoxes closing = _board.replayAsOf(d);
    final DailyMovements movements = _movements(d);
    final BoardSnapshot live = _board.compute(asOf: d);
    final row = _row(d);

    final blockers = <Blocker>[];

    // 規則 1：昨日期末五格 ≠ 今日期初五格 ⇒ 不可認證。
    final prevRow = _row(prev);
    if (prevRow != null && prevRow['certified_at'] != null) {
      final prevClosing = _boxesFromJson(
        jsonDecode(prevRow['closing_json'] as String) as Map<String, dynamic>,
      );
      final diffs = _diff(prevClosing, opening);
      if (diffs.isNotEmpty) {
        blockers.add(
          Blocker(
            '昨日期末五格與今日期初五格對不起來',
            detail: diffs
                .map((i) => '${i.box}：昨日期末 ${formatMoney(i.stateCents)}、'
                    '今日期初 ${formatMoney(i.replayCents)}')
                .join('；'),
          ),
        );
      }
    }

    // 規則 2：現況與流水重放不符（盤不平）⇒ 不可認證。
    if (!live.isBalanced) {
      blockers.add(
        Blocker(
          '盤不平：現況與流水重放對不起來',
          detail: live.imbalances
              .map((i) => '${i.box} 差 ${formatMoney(i.diffCents)}')
              .join('；'),
        ),
      );
    }

    // 規則 3：存量格恆等式（期初 + 本期進出 = 期末）。
    // 只套在格 1、格 2 兩個「存量」格：它們只會因為交易而變動。
    // 格 3、格 4 是流量格，格 5 會隨日期經過自己長大（逾期不是交易造成的），
    // 恆等式在那三格本來就不成立，改由規則 2 的重放覆蓋。
    final int expectedBox1 =
        opening.outstandingPrincipal + movements.disbursed - _principalIn(d);
    if (expectedBox1 != closing.outstandingPrincipal) {
      blockers.add(
        Blocker(
          '格 1 不平：期初 + 放款 − 收本金 ≠ 期末',
          detail: '應為 ${formatMoney(expectedBox1)}，'
              '實為 ${formatMoney(closing.outstandingPrincipal)}',
        ),
      );
    }
    final int expectedBox2 =
        opening.heldFaceTotal + movements.heldFaceIn - movements.heldFaceOut;
    if (expectedBox2 != closing.heldFaceTotal) {
      blockers.add(
        Blocker(
          '格 2 不平：期初 + 收票票面 − 兌現與退票沖掉的票面 ≠ 期末',
          detail: '應為 ${formatMoney(expectedBox2)}，'
              '實為 ${formatMoney(closing.heldFaceTotal)}',
        ),
      );
    }

    return DailyCloseSheet(
      businessDate: d,
      opening: opening,
      movements: movements,
      closing: closing,
      imbalances: live.imbalances,
      unreconciled: live.unreconciled,
      blockers: blockers,
      reviewedBy: row?['reviewed_by'] as String?,
      confirmedBy: row?['confirmed_by'] as String?,
      certifiedBy: row?['certified_by'] as String?,
    );
  }

  // -------------------------------------------------------------- 四關

  /// 核定：把當天的日結存成快照，記下誰看過。
  void review(DateTime date, String userId) =>
      _stamp(date, userId, 'reviewed', requirePrevious: null);

  /// 確認：老闆按「盤我對過」。要先核定過。
  void confirm(DateTime date, String userId) =>
      _stamp(date, userId, 'confirmed', requirePrevious: 'reviewed');

  /// 認證：通過後鎖帳。要先確認過，而且 [DailyCloseSheet.blockers] 必須是空的。
  void certify(DateTime date, String userId) {
    final s = sheet(date);
    if (!s.isConfirmed) throw SettlementRejected('要先按「確認」，才能認證。');
    if (s.blockers.isNotEmpty) {
      throw SettlementRejected(
        '這一天還不能認證：${s.blockers.map((b) => b.reason).join('；')}。',
      );
    }
    _stamp(date, userId, 'certified', requirePrevious: 'confirmed');
  }

  void _stamp(
    DateTime date,
    String userId,
    String stage, {
    required String? requirePrevious,
  }) {
    final DateTime d = dateOnly(date);
    final s = sheet(d);
    if (s.isCertified) {
      throw SettlementRejected(
        '${formatDate(d)} 已經認證鎖帳，不能再改這張日結。',
      );
    }
    if (requirePrevious == 'reviewed' && !s.isReviewed) {
      throw SettlementRejected('要先按「核定」。');
    }
    if (requirePrevious == 'confirmed' && !s.isConfirmed) {
      throw SettlementRejected('要先按「確認」。');
    }

    final String now = DateTime.now().toIso8601String();
    db.execute(
      'INSERT INTO daily_closes (business_date, opening_json, movements_json, '
      'closing_json, imbalances_json, unreconciled_json) '
      'VALUES (?, ?, ?, ?, ?, ?) '
      'ON CONFLICT(business_date) DO UPDATE SET '
      '  opening_json = excluded.opening_json, '
      '  movements_json = excluded.movements_json, '
      '  closing_json = excluded.closing_json, '
      '  imbalances_json = excluded.imbalances_json, '
      '  unreconciled_json = excluded.unreconciled_json',
      [
        formatDate(d),
        jsonEncode(s.opening.asMap()),
        jsonEncode(s.movements.toJson()),
        jsonEncode(s.closing.asMap()),
        jsonEncode([
          for (final i in s.imbalances)
            {'box': i.box, 'state': i.stateCents, 'replay': i.replayCents},
        ]),
        jsonEncode([
          for (final u in s.unreconciled)
            {
              'kind': u.kind,
              'label': u.label,
              'due': formatDate(u.dueDate),
              'amount': u.amountCents,
            },
        ]),
      ],
    );
    db.execute(
      'UPDATE daily_closes SET ${stage}_at = ?, ${stage}_by = ? '
      'WHERE business_date = ?',
      [now, userId, formatDate(d)],
    );
  }

  // ------------------------------------------------------------ 內部

  Row? _row(DateTime date) {
    final rows = db.select(
      'SELECT * FROM daily_closes WHERE business_date = ?',
      [formatDate(dateOnly(date))],
    );
    return rows.isEmpty ? null : rows.first;
  }

  int _sum(DateTime date, List<String> types) {
    final placeholders = List.filled(types.length, '?').join(',');
    final rows = db.select(
      'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM entries '
      'WHERE entry_date = ? AND type IN ($placeholders)',
      [formatDate(dateOnly(date)), ...types],
    );
    return rows.first['total'] as int;
  }

  int _principalIn(DateTime date) => _sum(date, [EntryType.collectPrincipal]);

  DailyMovements _movements(DateTime date) {
    final int cashed = _sum(date, [
      EntryType.checkCashPartial,
      EntryType.checkCashFull,
    ]);
    // 退票當天從格 2 拿掉的是「當時的未收票面」，不一定等於追償金額。
    int bounceFaceOut = 0;
    for (final row in db.select(
      'SELECT check_id, check_face_cents FROM entries '
      'WHERE entry_date = ? AND type = ?',
      [formatDate(dateOnly(date)), EntryType.checkBounce],
    )) {
      final cashedBefore = db.select(
        'SELECT COALESCE(SUM(amount_cents), 0) AS c FROM entries '
        'WHERE check_id = ? AND type IN (?, ?)',
        [
          row['check_id'],
          EntryType.checkCashPartial,
          EntryType.checkCashFull,
        ],
      ).first['c'] as int;
      final int outstanding = (row['check_face_cents'] as int) - cashedBefore;
      bounceFaceOut += outstanding > 0 ? outstanding : 0;
    }

    return DailyMovements(
      disbursed: _sum(date, [EntryType.loanDisburse]),
      loanCollected: _sum(date, [
        EntryType.collectPenalty,
        EntryType.collectFee,
        EntryType.collectInterest,
        EntryType.collectPrincipal,
      ]),
      checkCashPaid: _sum(date, [EntryType.checkReceive]),
      checkCashed: cashed,
      checkBounced: _sum(date, [EntryType.checkBounce]),
      heldFaceIn: db.select(
        'SELECT COALESCE(SUM(check_face_cents), 0) AS total FROM entries '
        'WHERE entry_date = ? AND type = ?',
        [formatDate(dateOnly(date)), EntryType.checkReceive],
      ).first['total'] as int,
      heldFaceOut: cashed + bounceFaceOut,
    );
  }

  static FiveBoxes _boxesFromJson(Map<String, dynamic> j) => FiveBoxes(
    outstandingPrincipal: j['格1 在外借款本金'] as int,
    heldFaceNotDue: j['格2a 其中未到期'] as int,
    heldFaceOverdueUnhandled: j['格2b 其中已到期未處理'] as int,
    dueToday: j['格3 今日應收'] as int,
    receivedToday: j['格4 今日已收'] as int,
    overdueAndRecourse: j['格5 逾期＋追償'] as int,
  );

  /// 比較兩組五格，只回不一樣的（存量格才有意義；流量格與逾期格會隨日期變動，
  /// 昨日期末的「今日應收／今日已收」本來就跟今天不同，不列入比較）。
  static List<Imbalance> _diff(FiveBoxes a, FiveBoxes b) {
    const stockBoxes = {
      '格1 在外借款本金',
      '格2 持有票面合計',
    };
    final result = <Imbalance>[];
    final ma = a.asMap();
    final mb = b.asMap();
    for (final key in stockBoxes) {
      if (ma[key] != mb[key]) {
        result.add(
          Imbalance(box: key, stateCents: ma[key]!, replayCents: mb[key]!),
        );
      }
    }
    return result;
  }
}
