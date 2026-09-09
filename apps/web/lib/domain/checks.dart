import 'dart:convert';

import 'package:sqlite3/sqlite3.dart';

import '../db/schema.dart';
import '../money.dart';
import 'lock.dart';
import 'settlement.dart' show newId, SettlementRejected;

/// 票據寫入。**本輪沒有畫面**（收票／兌現／退票的 UI 不在這一輪範圍），
/// 這裡只提供函式，讓活盤格 2、格 3、格 5 與紅字清單有真實資料可以算、
/// 也讓「部分兌現剩餘票面仍留在格 2」這條規則測得到。
class CheckService {
  CheckService(this.db) : _lock = LockGuard(db);

  final Database db;
  final LockGuard _lock;

  /// 收票（貼現）。恆等式：`實付 = 票面 − 貼現息 − 其他費用`，不符不准存。
  String receive({
    required String opId,
    required String operatorId,
    required String customerId,
    required String bankCode,
    required String checkNo,
    required int faceCents,
    required int discountInterestCents,
    required int cashPaidCents,
    required int otherFeeCents,
    required DateTime dueDate,
    required DateTime receivedDate,
  }) {
    _lock.assertOpen(receivedDate);
    final int expected = faceCents - discountInterestCents - otherFeeCents;
    if (cashPaidCents != expected) {
      throw SettlementRejected(
        '實付 ≠ 票面 − 貼現息 − 其他費用，差 '
        '${formatMoney(cashPaidCents - expected)}，'
        '請把數字改到相符或填「其他費用」。',
      );
    }
    final String id = newId();
    db.execute('BEGIN IMMEDIATE');
    try {
      db.execute(
        'INSERT INTO operations '
        '(op_id, kind, operator_id, entry_date, created_at, result_json) '
        'VALUES (?, ?, ?, ?, ?, ?)',
        [
          opId,
          'RECEIVE_CHECK',
          operatorId,
          formatDate(receivedDate),
          DateTime.now().toIso8601String(),
          jsonEncode({'check_id': id, 'cash_paid_cents': cashPaidCents}),
        ],
      );
      db.execute(
        'INSERT INTO checks (id, customer_id, bank_code, check_no, face_cents, '
        'due_date, received_date, discount_interest_cents, cash_paid_cents, '
        'other_fee_cents, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          customerId,
          bankCode,
          checkNo,
          faceCents,
          formatDate(dueDate),
          formatDate(receivedDate),
          discountInterestCents,
          cashPaidCents,
          otherFeeCents,
          CheckStatus.held,
        ],
      );
      _entry(
        opId: opId,
        entryDate: receivedDate,
        type: EntryType.checkReceive,
        amount: cashPaidCents,
        checkId: id,
        faceCents: faceCents,
        dueDate: dueDate,
        operatorId: operatorId,
      );
      db.execute('COMMIT');
    } catch (_) {
      db.execute('ROLLBACK');
      rethrow;
    }
    return id;
  }

  /// 兌現。
  ///
  /// **部分兌現不改狀態**（docs/BOSS-SPEC.md C-3）：只累加 `cashed_amount`，
  /// 票仍是「持有」，剩餘票面留在活盤格 2；到期日過了就變成「已到期未處理」
  /// 並進紅字清單。只有票面收足才走 `持有 → 已兌現`。
  void cash({
    required String opId,
    required String operatorId,
    required String checkId,
    required int receivedCents,
    required DateTime cashedAt,
    String? diffReason,
  }) {
    _lock.assertOpen(cashedAt);
    final rows = db.select('SELECT * FROM checks WHERE id = ?', [checkId]);
    if (rows.isEmpty) throw SettlementRejected('請先選到要兌現的票。');
    final row = rows.first;
    final int face = row['face_cents'] as int;
    final int already = row['cashed_amount_cents'] as int;
    final int newTotal = already + receivedCents;
    if (newTotal != face && (diffReason == null || diffReason.isEmpty)) {
      throw SettlementRejected(
        '實收與票面差 ${formatMoney(newTotal - face)}，請選差額原因。',
      );
    }
    final bool full = newTotal >= face;

    db.execute('BEGIN IMMEDIATE');
    try {
      db.execute(
        'INSERT INTO operations '
        '(op_id, kind, operator_id, entry_date, created_at, result_json) '
        'VALUES (?, ?, ?, ?, ?, ?)',
        [
          opId,
          'CASH_CHECK',
          operatorId,
          formatDate(cashedAt),
          DateTime.now().toIso8601String(),
          jsonEncode({'check_id': checkId, 'received_cents': receivedCents}),
        ],
      );
      db.execute(
        'UPDATE checks SET cashed_amount_cents = cashed_amount_cents + ?, '
        "status = ?, settled_at = ? "
        "WHERE id = ? AND status = ?",
        [
          receivedCents,
          full ? CheckStatus.cashed : CheckStatus.held,
          full ? formatDate(cashedAt) : null,
          checkId,
          CheckStatus.held,
        ],
      );
      if (db.updatedRows != 1) {
        throw SettlementRejected('這張票目前不是「持有」狀態，不能兌現。');
      }
      _entry(
        opId: opId,
        entryDate: cashedAt,
        type: full ? EntryType.checkCashFull : EntryType.checkCashPartial,
        amount: receivedCents,
        checkId: checkId,
        faceCents: face,
        dueDate: parseDate(row['due_date'] as String),
        operatorId: operatorId,
      );
      db.execute('COMMIT');
    } catch (_) {
      db.execute('ROLLBACK');
      rethrow;
    }
  }

  /// 退票並轉追償。追償金額預設＝**未收票面**，改了必留原因。
  void bounce({
    required String opId,
    required String operatorId,
    required String checkId,
    required int recourseCents,
    required DateTime bouncedAt,
    String? reason,
  }) {
    _lock.assertOpen(bouncedAt);
    final rows = db.select('SELECT * FROM checks WHERE id = ?', [checkId]);
    if (rows.isEmpty) throw SettlementRejected('請先選到要退票的票。');
    final row = rows.first;
    final int outstanding =
        (row['face_cents'] as int) - (row['cashed_amount_cents'] as int);
    if (recourseCents != outstanding && (reason == null || reason.isEmpty)) {
      throw SettlementRejected('追償金額與未收票面不同，請填原因。');
    }
    db.execute('BEGIN IMMEDIATE');
    try {
      db.execute(
        'INSERT INTO operations '
        '(op_id, kind, operator_id, entry_date, created_at, result_json) '
        'VALUES (?, ?, ?, ?, ?, ?)',
        [
          opId,
          'BOUNCE_CHECK',
          operatorId,
          formatDate(bouncedAt),
          DateTime.now().toIso8601String(),
          jsonEncode({'check_id': checkId, 'recourse_cents': recourseCents}),
        ],
      );
      db.execute(
        'UPDATE checks SET status = ?, recourse_amount_cents = ? '
        'WHERE id = ? AND status = ?',
        [CheckStatus.recourse, recourseCents, checkId, CheckStatus.held],
      );
      if (db.updatedRows != 1) {
        throw SettlementRejected('這張票目前不是「持有」狀態，不能退票。');
      }
      _entry(
        opId: opId,
        entryDate: bouncedAt,
        type: EntryType.checkBounce,
        amount: recourseCents,
        checkId: checkId,
        faceCents: row['face_cents'] as int,
        dueDate: parseDate(row['due_date'] as String),
        operatorId: operatorId,
      );
      db.execute('COMMIT');
    } catch (_) {
      db.execute('ROLLBACK');
      rethrow;
    }
  }

  void _entry({
    required String opId,
    required DateTime entryDate,
    required String type,
    required int amount,
    required String checkId,
    required int faceCents,
    required DateTime dueDate,
    required String operatorId,
  }) {
    db.execute(
      'INSERT INTO entries (id, op_id, entry_date, posted_at, type, amount_cents, '
      'check_id, check_face_cents, check_due_date, operator_id) '
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        newId(),
        opId,
        formatDate(entryDate),
        DateTime.now().toIso8601String(),
        type,
        amount,
        checkId,
        faceCents,
        formatDate(dueDate),
        operatorId,
      ],
    );
  }
}
