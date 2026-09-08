import 'package:drift/drift.dart';

import 'tables.dart';

part 'app_database.g.dart';

/// App 主資料庫。實際 App 執行時由 `connection.dart` 的
/// `openEncryptedConnection()` 開啟（SQLCipher 加密、僅存本機，不上傳伺服器，
/// 見 spec §0）；測試時可注入 `NativeDatabase.memory()`。
@DriftDatabase(
  tables: [
    Borrowers,
    Loans,
    ScheduleItems,
    LedgerEntries,
    Payments,
    LoanEvents,
    AppLicenseRows,
    AuditLogs,
  ],
)
class AppDatabase extends _$AppDatabase {
  AppDatabase(super.executor);

  @override
  int get schemaVersion => 1;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (Migrator m) async {
      await m.createAll();
    },
  );
}
