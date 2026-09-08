import 'package:drift/drift.dart';

/// 借款人。`idNumberCipher` / `addressCipher` / `bankAccountCipher` 為應用層
/// AES-256-GCM 加密後的密文（base64），`idHash` 為明文 SHA-256，僅供查重比對
/// （見 docs/ASSUMPTIONS.md §7：不明文比對）。
class Borrowers extends Table {
  TextColumn get id => text()();
  TextColumn get name => text()();
  TextColumn get idNumberCipher => text()();
  TextColumn get idHash => text()();
  TextColumn get phone => text().nullable()();
  TextColumn get addressCipher => text().nullable()();
  TextColumn get bankAccountCipher => text().nullable()();
  DateTimeColumn get createdAt => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}

/// 貸款。所有計息參數於建檔當下鎖定（含 `ruleVersion`），見
/// docs/interest-rules.md。`method`/`rateType`/`dayCount`/`status` 存 enum 的
/// `.name`。
class Loans extends Table {
  TextColumn get id => text()();
  TextColumn get borrowerId => text().references(Borrowers, #id)();
  IntColumn get principalCents => integer()();
  TextColumn get method => text()();
  TextColumn get rateType => text()();
  IntColumn get rateBps => integer()();
  TextColumn get dayCount => text()();
  IntColumn get tenorPeriods => integer()();
  IntColumn get periodDays => integer().withDefault(const Constant(30))();
  IntColumn get graceDays => integer().withDefault(const Constant(3))();
  BoolColumn get penaltyEnabled =>
      boolean().withDefault(const Constant(false))();
  IntColumn get penaltyRateBps => integer().withDefault(const Constant(600))();
  IntColumn get ruleVersion => integer().withDefault(const Constant(1))();
  TextColumn get status => text().withDefault(const Constant('draft'))();
  DateTimeColumn get disbursedAt => dateTime().nullable()();
  DateTimeColumn get lastAccrualAt => dateTime().nullable()();
  DateTimeColumn get createdAt => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}

/// 還款計畫項目。可依 [Loans] 的規則重算；`status` 存
/// `ScheduleItemStatus.name`。`paidCents` 為該期累計已分配到的收款金額，供
/// 逾期／待收計算使用（不重新加總整份 Schedule，見不變式 §6）。
class ScheduleItems extends Table {
  TextColumn get id => text()();
  TextColumn get loanId => text().references(Loans, #id)();
  IntColumn get periodNumber => integer()();
  DateTimeColumn get dueDate => dateTime()();
  IntColumn get openingBalanceCents => integer()();
  IntColumn get principalCents => integer()();
  IntColumn get interestCents => integer()();
  IntColumn get closingBalanceCents => integer()();
  TextColumn get status => text().withDefault(const Constant('due'))();
  IntColumn get interestPaidCents => integer().withDefault(const Constant(0))();
  IntColumn get principalPaidCents =>
      integer().withDefault(const Constant(0))();

  @override
  Set<Column> get primaryKey => {id};
}

/// Append-only 分錄。本表在 DAO 層只提供新增方法，不提供更新／刪除。
///
/// Row 類別命名為 `LedgerEntryRow`（而非 Drift 預設的 `LedgerEntry`），避免與
/// `package:ledger` 的 `LedgerEntry` 撞名。
@DataClassName('LedgerEntryRow')
class LedgerEntries extends Table {
  TextColumn get id => text()();
  TextColumn get loanId => text().references(Loans, #id)();
  TextColumn get type => text()();
  IntColumn get amountCents => integer()();
  DateTimeColumn get postedAt => dateTime()();
  IntColumn get relatedPeriodNumber => integer().nullable()();
  TextColumn get note => text().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}

/// 一筆收款紀錄（含瀑布分配結果，見 docs/interest-rules.md §6）。
class Payments extends Table {
  TextColumn get id => text()();
  TextColumn get loanId => text().references(Loans, #id)();
  IntColumn get amountCents => integer()();
  DateTimeColumn get paidAt => dateTime()();
  IntColumn get penaltyCents => integer().withDefault(const Constant(0))();
  IntColumn get feeCents => integer().withDefault(const Constant(0))();
  IntColumn get interestCents => integer().withDefault(const Constant(0))();
  IntColumn get principalCents => integer().withDefault(const Constant(0))();
  IntColumn get overpaymentCents => integer().withDefault(const Constant(0))();
  TextColumn get note => text().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}

/// 貸款事件（改利率／展期／部分還本／狀態變更／減免／核貸建議），見
/// docs/interest-rules.md §4、docs/state-machines.md §1。
class LoanEvents extends Table {
  TextColumn get id => text()();
  TextColumn get loanId => text().references(Loans, #id)();
  TextColumn get type => text()();
  TextColumn get payload => text()();
  DateTimeColumn get createdAt => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}

/// 授權狀態（單列，`id` 恆為 `'singleton'`）。
class AppLicenseRows extends Table {
  TextColumn get id => text()();
  TextColumn get licenseCode => text().nullable()();
  TextColumn get licenseId => text().nullable()();
  TextColumn get deviceId => text().nullable()();
  BoolColumn get isLicensed => boolean().withDefault(const Constant(false))();
  IntColumn get usedCount => integer().withDefault(const Constant(0))();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}

/// 稽核紀錄。
class AuditLogs extends Table {
  TextColumn get id => text()();
  TextColumn get action => text()();
  TextColumn get entityType => text()();
  TextColumn get entityId => text()();
  TextColumn get detail => text().nullable()();
  DateTimeColumn get createdAt => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}
