import 'package:sqlite3/sqlite3.dart';

/// 第 1 版資料表。欄位對照 docs/DATA-MIN.md，沒列在那份文件裡的欄位不存。
///
/// 兩個唯一鍵是整套防重複的地基（見 docs/BOSS-SPEC.md C-0）：
/// * `operations.op_id` — 同一次送出只會成立一次（雙擊、重送、上一頁再送）。
/// * `checks(bank_code, check_no)` — 同一張票不可能被收兩次。
const List<String> kSchema = [
  '''
CREATE TABLE IF NOT EXISTS customers (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  id_number_last4   TEXT NOT NULL,
  id_number_hash    TEXT NOT NULL,
  phone             TEXT
)''',
  '''
CREATE TABLE IF NOT EXISTS loans (
  id                TEXT PRIMARY KEY,
  customer_id       TEXT NOT NULL REFERENCES customers(id),
  principal_cents   INTEGER NOT NULL,
  method            TEXT NOT NULL,
  rate_type         TEXT NOT NULL,
  rate_bps          INTEGER NOT NULL,
  day_count         TEXT NOT NULL,
  tenor_periods     INTEGER NOT NULL,
  period_days       INTEGER NOT NULL DEFAULT 30,
  grace_days        INTEGER NOT NULL DEFAULT 3,
  penalty_enabled   INTEGER NOT NULL DEFAULT 0,
  penalty_rate_bps  INTEGER NOT NULL DEFAULT 600,
  disbursed_at      TEXT,
  status            TEXT NOT NULL
)''',
  '''
CREATE TABLE IF NOT EXISTS schedule_items (
  loan_id               TEXT NOT NULL REFERENCES loans(id),
  seq                   INTEGER NOT NULL,
  due_date              TEXT NOT NULL,
  opening_balance_cents INTEGER NOT NULL,
  principal_cents       INTEGER NOT NULL,
  interest_cents        INTEGER NOT NULL,
  fee_cents             INTEGER NOT NULL DEFAULT 0,
  principal_paid_cents  INTEGER NOT NULL DEFAULT 0,
  interest_paid_cents   INTEGER NOT NULL DEFAULT 0,
  fee_paid_cents        INTEGER NOT NULL DEFAULT 0,
  penalty_paid_cents    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (loan_id, seq)
)''',
  '''
CREATE TABLE IF NOT EXISTS checks (
  id                      TEXT PRIMARY KEY,
  customer_id             TEXT NOT NULL REFERENCES customers(id),
  bank_code               TEXT NOT NULL,
  check_no                TEXT NOT NULL,
  face_cents              INTEGER NOT NULL,
  due_date                TEXT NOT NULL,
  received_date           TEXT NOT NULL,
  discount_interest_cents INTEGER NOT NULL DEFAULT 0,
  cash_paid_cents         INTEGER NOT NULL DEFAULT 0,
  other_fee_cents         INTEGER NOT NULL DEFAULT 0,
  cashed_amount_cents     INTEGER NOT NULL DEFAULT 0,
  recourse_amount_cents   INTEGER NOT NULL DEFAULT 0,
  recovered_cents         INTEGER NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL,
  settled_at              TEXT,
  UNIQUE (bank_code, check_no)
)''',
  '''
CREATE TABLE IF NOT EXISTS operations (
  op_id       TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  entry_date  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  result_json TEXT NOT NULL
)''',
  '''
CREATE TABLE IF NOT EXISTS entries (
  id                TEXT PRIMARY KEY,
  op_id             TEXT NOT NULL REFERENCES operations(op_id),
  entry_date        TEXT NOT NULL,
  posted_at         TEXT NOT NULL,
  type              TEXT NOT NULL,
  amount_cents      INTEGER NOT NULL,
  loan_id           TEXT,
  schedule_seq      INTEGER,
  check_id          TEXT,
  check_face_cents  INTEGER,
  check_due_date    TEXT,
  operator_id       TEXT NOT NULL,
  note              TEXT
)''',
  'CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(entry_date)',
  'CREATE INDEX IF NOT EXISTS idx_entries_loan ON entries(loan_id, schedule_seq)',
  'CREATE INDEX IF NOT EXISTS idx_entries_check ON entries(check_id)',
];

/// 分錄類型。重放（replay）只認得這些字串。
class EntryType {
  static const String loanDisburse = 'LOAN_DISBURSE';
  static const String collectPenalty = 'LOAN_COLLECT_PENALTY';
  static const String collectFee = 'LOAN_COLLECT_FEE';
  static const String collectInterest = 'LOAN_COLLECT_INTEREST';
  static const String collectPrincipal = 'LOAN_COLLECT_PRINCIPAL';

  /// 溢繳。金額為負，**不計入在貸本金**（本金已收滿才可能溢繳），
  /// 是一筆待人工處理的應付款。
  static const String overpayAdjust = 'LOAN_OVERPAY_ADJUST';

  static const String checkReceive = 'CHECK_RECEIVE';
  static const String checkCashPartial = 'CHECK_CASH_PARTIAL';
  static const String checkCashFull = 'CHECK_CASH_FULL';
  static const String checkBounce = 'CHECK_BOUNCE';
  static const String checkRecover = 'CHECK_RECOVER';
}

class CheckStatus {
  static const String held = '持有';
  static const String cashed = '已兌現';
  static const String recourse = '退票追償中';
  static const String recovered = '已追回';
}

Database openDatabase({String path = ':memory:'}) {
  final db = sqlite3.open(path);
  db.execute('PRAGMA foreign_keys = ON;');
  for (final statement in kSchema) {
    db.execute(statement);
  }
  return db;
}
