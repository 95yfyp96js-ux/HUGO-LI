import 'package:lending_engine/lending_engine.dart' as engine;
import 'package:sqlite3/sqlite3.dart';

import '../domain/model.dart';
import '../money.dart';
import 'schema.dart';

/// 讀取層：把資料表讀成領域物件。
///
/// **計畫表的結構（每期本金／利息／到期日）一律由 `lending_engine` 重算**，
/// 資料庫只存「已繳了多少」。這樣一來，有人手改資料庫裡的金額欄位時，
/// 重算出來的結構會跟他改的東西對不上，活盤就會打「盤不平」。
class Store {
  Store(this.db);

  final Database db;

  // ------------------------------------------------------------------ 客戶

  String customerName(String id) {
    final rows = db.select('SELECT name FROM customers WHERE id = ?', [id]);
    return rows.isEmpty ? '（查無客戶）' : rows.first['name'] as String;
  }

  // ------------------------------------------------------------------ 貸款

  Loan? loanById(String id) {
    final rows = db.select('SELECT * FROM loans WHERE id = ?', [id]);
    return rows.isEmpty ? null : _mapLoan(rows.first);
  }

  List<Loan> disbursedLoans() {
    final rows = db.select(
      "SELECT * FROM loans WHERE disbursed_at IS NOT NULL AND status <> 'draft' "
      'ORDER BY disbursed_at DESC',
    );
    return rows.map(_mapLoan).toList();
  }

  Loan _mapLoan(Row r) => Loan(
    id: r['id'] as String,
    customerId: r['customer_id'] as String,
    principalCents: r['principal_cents'] as int,
    method: r['method'] as String,
    rateType: r['rate_type'] as String,
    rateBps: r['rate_bps'] as int,
    dayCount: r['day_count'] as String,
    tenorPeriods: r['tenor_periods'] as int,
    periodDays: r['period_days'] as int,
    graceDays: r['grace_days'] as int,
    penaltyEnabled: (r['penalty_enabled'] as int) == 1,
    penaltyRateBps: r['penalty_rate_bps'] as int,
    disbursedAt: r['disbursed_at'] == null
        ? null
        : parseDate(r['disbursed_at'] as String),
    status: r['status'] as String,
  );

  // -------------------------------------------------------------- 計畫表

  /// 一筆貸款的計畫表現況：**結構重算 + 已繳金額查表**。
  List<PeriodState> scheduleFor(Loan loan) {
    final engine.ScheduleResult result = engine.generateSchedule(loan.terms());
    final paid = <int, Row>{};
    for (final row in db.select(
      'SELECT * FROM schedule_items WHERE loan_id = ?',
      [loan.id],
    )) {
      paid[row['seq'] as int] = row;
    }
    return [
      for (final item in result.items)
        PeriodState(
          loanId: loan.id,
          seq: item.periodNumber,
          dueDate: item.dueDate,
          principalCents: item.principalCents,
          interestCents: item.interestCents,
          feeCents: 0,
          principalPaidCents:
              (paid[item.periodNumber]?['principal_paid_cents'] as int?) ?? 0,
          interestPaidCents:
              (paid[item.periodNumber]?['interest_paid_cents'] as int?) ?? 0,
          feePaidCents:
              (paid[item.periodNumber]?['fee_paid_cents'] as int?) ?? 0,
          penaltyPaidCents:
              (paid[item.periodNumber]?['penalty_paid_cents'] as int?) ?? 0,
        ),
    ];
  }

  // ---------------------------------------------------------------- 票據

  List<CheckState> allChecks() {
    return db.select('SELECT * FROM checks ORDER BY due_date').map(_mapCheck).toList();
  }

  CheckState _mapCheck(Row r) => CheckState(
    id: r['id'] as String,
    bankCode: r['bank_code'] as String,
    checkNo: r['check_no'] as String,
    faceCents: r['face_cents'] as int,
    dueDate: parseDate(r['due_date'] as String),
    cashedAmountCents: r['cashed_amount_cents'] as int,
    recourseAmountCents: r['recourse_amount_cents'] as int,
    recoveredCents: r['recovered_cents'] as int,
    status: r['status'] as String,
  );

  // ---------------------------------------------------------------- 分錄

  List<Row> entriesForLoan(String loanId) => db.select(
    'SELECT * FROM entries WHERE loan_id = ? ORDER BY posted_at, id',
    [loanId],
  );

  /// 某一期已入帳的罰息合計（避免重複計提）。
  int billedPenaltyCents(String loanId, int seq) {
    final rows = db.select(
      'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM entries '
      'WHERE loan_id = ? AND schedule_seq = ? AND type = ?',
      [loanId, seq, EntryType.collectPenalty],
    );
    return rows.first['total'] as int;
  }
}
