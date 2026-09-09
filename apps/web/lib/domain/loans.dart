import 'dart:convert';

import 'package:lending_engine/lending_engine.dart' as engine;
import 'package:sqlite3/sqlite3.dart';

import '../db/schema.dart';
import '../money.dart';
import 'lock.dart';
import 'settlement.dart' show newId, SettlementRejected;

/// 建客戶、建借款、確認撥付。**本輪沒有畫面**（那是按鈕 1～3，不在這一輪
/// 範圍），這裡只提供函式，讓收款核銷畫面與活盤有真實資料可用。
class LoanService {
  LoanService(this.db) : _lock = LockGuard(db);

  final Database db;
  final LockGuard _lock;

  String createCustomer({
    required String name,
    required String idNumber,
    String? phone,
  }) {
    final String hash = _hash(idNumber);
    final dup = db.select(
      'SELECT name, id_number_last4 FROM customers WHERE id_number_hash = ?',
      [hash],
    );
    if (dup.isNotEmpty) {
      throw SettlementRejected(
        '這個證號已經有客戶了：${dup.first['name']}'
        '（末四碼 ****${dup.first['id_number_last4']}）。'
        '要用同一位客戶請直接選他。',
      );
    }
    final String id = newId();
    // 只存末四碼與雜湊，完整證號不進這個第 1 版（docs/DATA-MIN.md）。
    db.execute(
      'INSERT INTO customers (id, name, id_number_last4, id_number_hash, phone) '
      'VALUES (?, ?, ?, ?, ?)',
      [
        id,
        name,
        idNumber.length <= 4
            ? idNumber
            : idNumber.substring(idNumber.length - 4),
        hash,
        phone,
      ],
    );
    return id;
  }

  String registerLoan({
    required String customerId,
    required int principalCents,
    required engine.RepaymentMethod method,
    required engine.RateType rateType,
    required int rateBps,
    required engine.DayCount dayCount,
    required int tenorPeriods,
    int periodDays = 30,
    int graceDays = 3,
    bool penaltyEnabled = false,
    int penaltyRateBps = 600,
  }) {
    final String id = newId();
    db.execute(
      'INSERT INTO loans (id, customer_id, principal_cents, method, rate_type, '
      'rate_bps, day_count, tenor_periods, period_days, grace_days, '
      'penalty_enabled, penalty_rate_bps, status) '
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')",
      [
        id,
        customerId,
        principalCents,
        method.name,
        rateType.name,
        rateBps,
        dayCount.name,
        tenorPeriods,
        periodDays,
        graceDays,
        penaltyEnabled ? 1 : 0,
        penaltyRateBps,
      ],
    );
    return id;
  }

  /// 確認撥付。撥付日**不可以是未來**，且只能撥一次。
  void confirmDisbursement({
    required String opId,
    required String operatorId,
    required String loanId,
    required DateTime disbursedAt,
    DateTime? now,
  }) {
    final DateTime today = dateOnly(now ?? DateTime.now());
    if (dateOnly(disbursedAt).isAfter(today)) {
      throw SettlementRejected('撥付日不可以是未來日期。');
    }
    _lock.assertOpen(disbursedAt);
    db.execute('BEGIN IMMEDIATE');
    try {
      db.execute(
        'INSERT INTO operations '
        '(op_id, kind, operator_id, entry_date, created_at, result_json) '
        'VALUES (?, ?, ?, ?, ?, ?)',
        [
          opId,
          'DISBURSE',
          operatorId,
          formatDate(disbursedAt),
          DateTime.now().toIso8601String(),
          jsonEncode({'loan_id': loanId}),
        ],
      );
      final rows = db.select('SELECT principal_cents, disbursed_at FROM loans WHERE id = ?', [loanId]);
      if (rows.isEmpty) throw SettlementRejected('找不到這筆借款。');
      if (rows.first['disbursed_at'] != null) {
        throw SettlementRejected(
          '這筆借款已經撥付過了（${rows.first['disbursed_at']}），不能再撥一次。',
        );
      }
      db.execute(
        "UPDATE loans SET disbursed_at = ?, status = 'current' "
        'WHERE id = ? AND disbursed_at IS NULL',
        [formatDate(disbursedAt), loanId],
      );
      if (db.updatedRows != 1) {
        throw SettlementRejected('這筆借款已經撥付過了，不能再撥一次。');
      }
      db.execute(
        'INSERT INTO entries (id, op_id, entry_date, posted_at, type, '
        'amount_cents, loan_id, operator_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          newId(),
          opId,
          formatDate(disbursedAt),
          DateTime.now().toIso8601String(),
          EntryType.loanDisburse,
          rows.first['principal_cents'] as int,
          loanId,
          operatorId,
        ],
      );
      db.execute('COMMIT');
    } catch (_) {
      db.execute('ROLLBACK');
      rethrow;
    }
  }

  /// 查重用的雜湊。第 1 版不明文比對證號。
  static String _hash(String value) {
    var h = 0x811c9dc5;
    for (final unit in value.codeUnits) {
      h = ((h ^ unit) * 0x01000193) & 0xFFFFFFFF;
    }
    return h.toRadixString(16).padLeft(8, '0');
  }
}
