import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ledger/ledger.dart' as ledger;
import 'package:shared_preferences/shared_preferences.dart';

import '../db/app_database.dart';
import '../db/backup_service.dart';
import '../db/db_key_store.dart';
import '../db/pii_codec.dart';
import '../domain/borrower_repository.dart';
import '../domain/dashboard_repository.dart';
import '../domain/license_repository.dart';
import '../domain/loan_repository.dart';

/// 由 `main.dart` 於啟動時 `overrideWithValue`，App 內其餘 provider 皆從這裡
/// 衍生，不各自重開資料庫連線。
final databaseProvider = Provider<AppDatabase>((ref) {
  throw UnimplementedError(
    'databaseProvider 必須在 main() 以 overrideWithValue 提供',
  );
});

final sharedPreferencesProvider = Provider<SharedPreferences>((ref) {
  throw UnimplementedError(
    'sharedPreferencesProvider 必須在 main() 以 overrideWithValue 提供',
  );
});

final piiCodecProvider = Provider<PiiCodec>((ref) {
  throw UnimplementedError(
    'piiCodecProvider 必須在 main() 以 overrideWithValue 提供',
  );
});

/// 對應 `--dart-define=DEV_LICENSE=1`（見 spec §7）。
final devLicenseOverrideProvider = Provider<bool>((ref) => false);

/// 這次啟動時資料庫金鑰是從哪裡來的（設定頁的「儲存狀態」會顯示遷移結果）。
final dbKeyOriginProvider = Provider<DbKeyOrigin>(
  (ref) => DbKeyOrigin.secureStorage,
);

final backupServiceProvider = Provider<BackupService>(
  (ref) => BackupService(ref.watch(databaseProvider)),
);

final deviceIdProvider = Provider<PersistedDeviceIdProvider>((ref) {
  return PersistedDeviceIdProvider(ref.watch(sharedPreferencesProvider));
});

final borrowerRepositoryProvider = Provider<BorrowerRepository>((ref) {
  return BorrowerRepository(
    ref.watch(databaseProvider),
    ref.watch(piiCodecProvider),
  );
});

final loanRepositoryProvider = Provider<LoanRepository>((ref) {
  return LoanRepository(ref.watch(databaseProvider));
});

final dashboardRepositoryProvider = Provider<DashboardRepository>((ref) {
  return DashboardRepository(ref.watch(loanRepositoryProvider));
});

final licenseRepositoryProvider = Provider<LicenseRepository>((ref) {
  return LicenseRepository(
    ref.watch(databaseProvider),
    ref.watch(deviceIdProvider),
    devOverride: ref.watch(devLicenseOverrideProvider),
  );
});

/// 借款人清單（即時，隨資料庫變動自動更新）。
final borrowersStreamProvider = StreamProvider((ref) {
  return ref.watch(borrowerRepositoryProvider).watchAll();
});

/// 貸款清單（即時）。
final loansStreamProvider = StreamProvider((ref) {
  return ref.watch(loanRepositoryProvider).watchAll();
});

/// 單一貸款的還款計畫（即時）。
final scheduleStreamProvider = StreamProvider.family((ref, String loanId) {
  return ref.watch(loanRepositoryProvider).watchScheduleFor(loanId);
});

/// 授權狀態列（即時）。
final licenseRowStreamProvider = StreamProvider((ref) {
  return ref.watch(licenseRepositoryProvider).watch();
});

/// 看板快照。呼叫端在寫入動作（撥款、收款）後呼叫
/// `ref.invalidate(dashboardSnapshotProvider)` 觸發重新計算（全部由 Ledger
/// 重放得出，見 docs/ASSUMPTIONS.md §8）。
final dashboardSnapshotProvider = FutureProvider<ledger.DashboardSnapshot>((
  ref,
) async {
  // 進看板前先補跑日結：逾期判定要算到今天，不能只靠 App 啟動那一次
  // （App 可能已經在背景待了好幾天，見 docs/interest-rules.md §5）。
  await ref.watch(loanRepositoryProvider).runDailyBatch();
  return ref.watch(dashboardRepositoryProvider).compute();
});
