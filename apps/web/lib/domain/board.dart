import 'dart:convert';

import 'package:lending_engine/lending_engine.dart' as engine;
import 'package:sqlite3/sqlite3.dart';

import '../db/schema.dart';
import '../db/store.dart';
import '../money.dart';

/// 活盤五格（docs/BOSS-SPEC.md D）。
///
/// 每一格算**兩次**：
/// * 現況（state）— 讀 `loans` / `schedule_items` / `checks` / `operations`。
/// * 重放（replay）— 只讀 `entries`，從第一筆事件疊到今天；計畫表結構由
///   `lending_engine` 依貸款條件重算，不看資料庫裡的計畫金額。
///
/// 兩條路是刻意分開的：有人手改 `schedule_items` 或 `checks` 而沒有留分錄，
/// 兩邊就對不起來，畫面直接打「盤不平」。**不准顯示 0、不准顯示快取、
/// 不准四捨五入把差額抹掉。差 1 分也是不平。**
class FiveBoxes {
  const FiveBoxes({
    required this.outstandingPrincipal,
    required this.heldFaceNotDue,
    required this.heldFaceOverdueUnhandled,
    required this.dueToday,
    required this.receivedToday,
    required this.overdueAndRecourse,
  });

  /// 格 1：在外借款本金。
  final int outstandingPrincipal;

  /// 格 2 拆列：未到期票面。
  final int heldFaceNotDue;

  /// 格 2 拆列：**已到期未處理**票面（G1 定案：算在格 2，不塞格 5）。
  final int heldFaceOverdueUnhandled;

  /// 格 3：今日應收。
  final int dueToday;

  /// 格 4：今日已收。
  final int receivedToday;

  /// 格 5：逾期借款餘額 + 退票追償中（**不含已到期未處理的票**）。
  final int overdueAndRecourse;

  /// 格 2：持有票面合計。
  int get heldFaceTotal => heldFaceNotDue + heldFaceOverdueUnhandled;

  Map<String, int> asMap() => {
    '格1 在外借款本金': outstandingPrincipal,
    '格2 持有票面合計': heldFaceTotal,
    '格2a 其中未到期': heldFaceNotDue,
    '格2b 其中已到期未處理': heldFaceOverdueUnhandled,
    '格3 今日應收': dueToday,
    '格4 今日已收': receivedToday,
    '格5 逾期＋追償': overdueAndRecourse,
  };
}

/// 一項對不上的差異。
class Imbalance {
  const Imbalance({
    required this.box,
    required this.stateCents,
    required this.replayCents,
  });

  final String box;
  final int stateCents;
  final int replayCents;
  int get diffCents => stateCents - replayCents;
}

/// 今日未核銷的到期項（紅字清單）。
class UnreconciledItem {
  const UnreconciledItem({
    required this.kind,
    required this.label,
    required this.dueDate,
    required this.amountCents,
  });

  final String kind; // '借款期別' | '票據'
  final String label;
  final DateTime dueDate;
  final int amountCents;
}

class BoardSnapshot {
  const BoardSnapshot({
    required this.businessDate,
    required this.state,
    required this.replay,
    required this.imbalances,
    required this.unreconciled,
  });

  final DateTime businessDate;
  final FiveBoxes state;
  final FiveBoxes replay;
  final List<Imbalance> imbalances;
  final List<UnreconciledItem> unreconciled;

  bool get isBalanced => imbalances.isEmpty;
}

class BoardService {
  BoardService(this.db) : _store = Store(db);

  final Database db;
  final Store _store;

  BoardSnapshot compute({DateTime? asOf}) {
    final DateTime today = dateOnly(asOf ?? DateTime.now());
    final FiveBoxes state = _fromState(today);
    final FiveBoxes replay = _fromReplay(today);

    final imbalances = <Imbalance>[];
    final s = state.asMap();
    final r = replay.asMap();
    for (final key in s.keys) {
      if (s[key] != r[key]) {
        imbalances.add(
          Imbalance(box: key, stateCents: s[key]!, replayCents: r[key]!),
        );
      }
    }

    return BoardSnapshot(
      businessDate: today,
      state: state,
      replay: replay,
      imbalances: imbalances,
      unreconciled: _unreconciled(today),
    );
  }

  // ------------------------------------------------------------ 現況

  FiveBoxes _fromState(DateTime today) {
    int outstandingPrincipal = 0;
    int dueToday = 0;
    int overdue = 0;

    for (final loan in _store.disbursedLoans()) {
      final schedule = _store.scheduleFor(loan);
      int paidPrincipal = 0;
      for (final item in schedule) {
        paidPrincipal += item.principalPaidCents;
        if (item.isSettled) continue;
        if (dateOnly(item.dueDate) == today) dueToday += item.shortfallCents;
        if (item.isOverdue(asOf: today, graceDays: loan.graceDays)) {
          overdue += item.shortfallCents;
        }
      }
      final int remaining = loan.principalCents - paidPrincipal;
      outstandingPrincipal += remaining > 0 ? remaining : 0;
    }

    int notDue = 0;
    int overdueUnhandled = 0;
    int recourse = 0;
    for (final check in _store.allChecks()) {
      if (check.status == CheckStatus.held) {
        if (dateOnly(check.dueDate).isAfter(today)) {
          notDue += check.outstandingFaceCents;
        } else {
          overdueUnhandled += check.outstandingFaceCents;
        }
        if (dateOnly(check.dueDate) == today) {
          dueToday += check.outstandingFaceCents;
        }
      } else if (check.status == CheckStatus.recourse) {
        recourse += check.recourseOutstandingCents;
      }
    }

    return FiveBoxes(
      outstandingPrincipal: outstandingPrincipal,
      heldFaceNotDue: notDue,
      heldFaceOverdueUnhandled: overdueUnhandled,
      dueToday: dueToday,
      receivedToday: _receivedTodayFromOperations(today),
      overdueAndRecourse: overdue + recourse,
    );
  }

  /// 格 4 的「現況」路徑刻意走 `operations`（我們宣稱收了多少），
  /// 重放路徑走 `entries`（帳上實際留下什麼）。有人動了分錄卻沒有對應的
  /// 操作紀錄，兩邊就對不起來。
  int _receivedTodayFromOperations(DateTime today) {
    int total = 0;
    for (final row in db.select(
      'SELECT kind, result_json FROM operations WHERE entry_date = ?',
      [formatDate(today)],
    )) {
      final json = jsonDecode(row['result_json'] as String) as Map<String, dynamic>;
      switch (row['kind'] as String) {
        case 'SETTLE_LOAN':
          total += (json['amount_cents'] as int) -
              (json['overpayment_cents'] as int);
        case 'CASH_CHECK':
          total += json['received_cents'] as int;
      }
    }
    return total;
  }

  // ------------------------------------------------------------ 重放

  FiveBoxes _fromReplay(DateTime today) {
    // 1. 借款：結構由引擎重算，已繳金額只認分錄。
    int outstandingPrincipal = 0;
    int dueToday = 0;
    int overdue = 0;

    for (final loan in _store.disbursedLoans()) {
      final result = engine.generateSchedule(loan.terms());
      final paidBySeq = <int, int>{}; // seq -> 已沖的本息費（不含罰息）
      int paidPrincipal = 0;
      for (final row in _store.entriesForLoan(loan.id)) {
        final int amount = row['amount_cents'] as int;
        final int? seq = row['schedule_seq'] as int?;
        switch (row['type'] as String) {
          case EntryType.collectPrincipal:
            paidPrincipal += amount;
            if (seq != null) paidBySeq[seq] = (paidBySeq[seq] ?? 0) + amount;
          case EntryType.collectInterest:
          case EntryType.collectFee:
            if (seq != null) paidBySeq[seq] = (paidBySeq[seq] ?? 0) + amount;
        }
      }
      final int remaining = loan.principalCents - paidPrincipal;
      outstandingPrincipal += remaining > 0 ? remaining : 0;

      for (final item in result.items) {
        final int dueTotal = item.principalCents + item.interestCents;
        final int shortfall = dueTotal - (paidBySeq[item.periodNumber] ?? 0);
        if (shortfall <= 0) continue;
        if (dateOnly(item.dueDate) == today) dueToday += shortfall;
        if (engine.isPastGrace(
          dueDate: item.dueDate,
          graceDays: loan.graceDays,
          asOf: today,
        )) {
          overdue += shortfall;
        }
      }
    }

    // 2. 票據：把 CHECK_* 分錄疊成每張票的狀態。
    final replayed = <String, _ReplayCheck>{};
    for (final row in db.select(
      "SELECT * FROM entries WHERE check_id IS NOT NULL ORDER BY posted_at, id",
    )) {
      final String id = row['check_id'] as String;
      final int amount = row['amount_cents'] as int;
      switch (row['type'] as String) {
        case EntryType.checkReceive:
          replayed[id] = _ReplayCheck(
            face: row['check_face_cents'] as int,
            due: parseDate(row['check_due_date'] as String),
          );
        case EntryType.checkCashPartial:
          replayed[id]?.cashed += amount; // 部分兌現：不改狀態
        case EntryType.checkCashFull:
          replayed[id]
            ?..cashed += amount
            ..status = CheckStatus.cashed;
        case EntryType.checkBounce:
          replayed[id]
            ?..status = CheckStatus.recourse
            ..recourse = amount;
        case EntryType.checkRecover:
          replayed[id]?.recovered += amount;
      }
    }

    int notDue = 0;
    int overdueUnhandled = 0;
    int recourse = 0;
    for (final c in replayed.values) {
      if (c.status == CheckStatus.held) {
        if (dateOnly(c.due).isAfter(today)) {
          notDue += c.outstanding;
        } else {
          overdueUnhandled += c.outstanding;
        }
        if (dateOnly(c.due) == today) dueToday += c.outstanding;
      } else if (c.status == CheckStatus.recourse) {
        recourse += c.recourseOutstanding;
      }
    }

    // 3. 今日已收：只認今天的分錄。
    int receivedToday = 0;
    for (final row in db.select(
      'SELECT type, amount_cents FROM entries WHERE entry_date = ?',
      [formatDate(today)],
    )) {
      switch (row['type'] as String) {
        case EntryType.collectPenalty:
        case EntryType.collectFee:
        case EntryType.collectInterest:
        case EntryType.collectPrincipal:
        case EntryType.checkCashPartial:
        case EntryType.checkCashFull:
          receivedToday += row['amount_cents'] as int;
      }
    }

    return FiveBoxes(
      outstandingPrincipal: outstandingPrincipal,
      heldFaceNotDue: notDue,
      heldFaceOverdueUnhandled: overdueUnhandled,
      dueToday: dueToday,
      receivedToday: receivedToday,
      overdueAndRecourse: overdue + recourse,
    );
  }

  // ------------------------------------------------ 今日未核銷的到期項

  /// 到期日已到（含逾期）卻還沒處理完的東西。
  ///
  /// **已到期未處理的持有票一定在這裡**（G1 定案）——它在格 2 有金額，
  /// 但沒有人動過它，這張清單是唯一會提醒老闆的地方。
  List<UnreconciledItem> _unreconciled(DateTime today) {
    final items = <UnreconciledItem>[];

    for (final loan in _store.disbursedLoans()) {
      final name = _store.customerName(loan.customerId);
      for (final period in _store.scheduleFor(loan)) {
        if (period.isSettled) continue;
        if (dateOnly(period.dueDate).isAfter(today)) continue;
        items.add(
          UnreconciledItem(
            kind: '借款期別',
            label: '$name · ${period.label}',
            dueDate: period.dueDate,
            amountCents: period.shortfallCents,
          ),
        );
      }
    }

    for (final check in _store.allChecks()) {
      if (check.status != CheckStatus.held) continue;
      if (dateOnly(check.dueDate).isAfter(today)) continue;
      final name = _store.customerName(
        (db.select('SELECT customer_id FROM checks WHERE id = ?', [check.id])
                .first['customer_id'])
            as String,
      );
      items.add(
        UnreconciledItem(
          kind: '票據',
          label: '$name · ${check.bankCode} ${check.maskedCheckNo}',
          dueDate: check.dueDate,
          amountCents: check.outstandingFaceCents,
        ),
      );
    }

    items.sort((a, b) => a.dueDate.compareTo(b.dueDate));
    return items;
  }
}

class _ReplayCheck {
  _ReplayCheck({required this.face, required this.due});
  final int face;
  final DateTime due;
  int cashed = 0;
  int recourse = 0;
  int recovered = 0;
  String status = CheckStatus.held;

  int get outstanding {
    final int remaining = face - cashed;
    return remaining > 0 ? remaining : 0;
  }

  int get recourseOutstanding {
    final int remaining = recourse - recovered;
    return remaining > 0 ? remaining : 0;
  }
}
