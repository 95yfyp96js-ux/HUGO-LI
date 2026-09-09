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

  List<({String id, String name, String last4})> customers() => db
      .select('SELECT id, name, id_number_last4 FROM customers ORDER BY name')
      .map(
        (r) => (
          id: r['id'] as String,
          name: r['name'] as String,
          last4: r['id_number_last4'] as String,
        ),
      )
      .toList();

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

  /// 建約了但還沒撥付的借款（「確認撥付」用）。
  List<Loan> undisbursedLoans() => db
      .select('SELECT * FROM loans WHERE disbursed_at IS NULL ORDER BY id')
      .map(_mapLoan)
      .toList();

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

  /// 仍是「持有」的票（兌現／退票的下拉用）。
  List<CheckState> heldChecks() => db
      .select(
        'SELECT * FROM checks WHERE status = ? ORDER BY due_date',
        [CheckStatus.held],
      )
      .map(_mapCheck)
      .toList();

  String customerIdForCheck(String checkId) => db
      .select('SELECT customer_id FROM checks WHERE id = ?', [checkId])
      .first['customer_id'] as String;

  // ---------------------------------------------------------------- 分錄

  List<Row> entriesForLoan(String loanId, {DateTime? upTo}) {
    if (upTo == null) {
      return db.select(
        'SELECT * FROM entries WHERE loan_id = ? ORDER BY entry_date, posted_at, id',
        [loanId],
      );
    }
    return db.select(
      'SELECT * FROM entries WHERE loan_id = ? AND entry_date <= ? '
      'ORDER BY entry_date, posted_at, id',
      [loanId, formatDate(upTo)],
    );
  }

  /// 某一天的流水。[operatorId] 有值時只回那個人自己登的
  /// （員工只看得到自己的，見 docs/BOSS-SPEC.md A）。
  List<Row> entriesForDate(DateTime date, {String? operatorId}) {
    final String d = formatDate(dateOnly(date));
    if (operatorId == null) {
      return db.select(
        'SELECT * FROM entries WHERE entry_date = ? ORDER BY posted_at, id',
        [d],
      );
    }
    return db.select(
      'SELECT * FROM entries WHERE entry_date = ? AND operator_id = ? '
      'ORDER BY posted_at, id',
      [d, operatorId],
    );
  }

  String? loanCustomerName(String? loanId) {
    if (loanId == null) return null;
    final rows = db.select(
      'SELECT c.name FROM loans l JOIN customers c ON c.id = l.customer_id '
      'WHERE l.id = ?',
      [loanId],
    );
    return rows.isEmpty ? null : rows.first['name'] as String;
  }

  ({String bank, String masked})? checkLabel(String? checkId) {
    if (checkId == null) return null;
    final rows = db.select(
      'SELECT bank_code, check_no FROM checks WHERE id = ?',
      [checkId],
    );
    if (rows.isEmpty) return null;
    final String no = rows.first['check_no'] as String;
    return (
      bank: rows.first['bank_code'] as String,
      masked: no.length <= 4 ? '****\$no' : '****\${no.substring(no.length - 4)}',
    );
  }

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
