import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app.dart';
import 'db/app_database.dart';
import 'db/connection.dart';
import 'db/db_key_store.dart';
import 'db/db_key_store_impl.dart';
import 'db/pii_codec.dart';
import 'domain/loan_repository.dart';
import 'providers/app_providers.dart';

/// 開發旁路：`--dart-define=DEV_LICENSE=1`（見 spec §7）。
const bool kDevLicenseOverride = bool.fromEnvironment('DEV_LICENSE');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final prefs = await SharedPreferences.getInstance();

  // 資料庫金鑰放 Keychain／Keystore；舊版存在 SharedPreferences 的會在這裡
  // 一次性搬過去，搬完才刪明文（見 db_key_store.dart）。
  final DbKeyResult dbKey = await ensureDbKey(
    secure: const SecureDbKeyStore(SecureDbKeyStore.defaultStorage),
    legacy: LegacyPrefsDbKeyStore(prefs),
  );

  final AppDatabase database = AppDatabase(
    openEncryptedConnection(passphrase: dbKey.passphrase),
  );
  final PiiCodec piiCodec = PiiCodec.fromPassphrase(dbKey.passphrase);

  // App 啟動即跑一次日結，補逾期判定與應計（見 docs/interest-rules.md §5）。
  await LoanRepository(database).runDailyBatch();

  runApp(
    ProviderScope(
      overrides: [
        databaseProvider.overrideWithValue(database),
        sharedPreferencesProvider.overrideWithValue(prefs),
        piiCodecProvider.overrideWithValue(piiCodec),
        devLicenseOverrideProvider.overrideWithValue(kDevLicenseOverride),
        dbKeyOriginProvider.overrideWithValue(dbKey.origin),
      ],
      child: const LendingApp(),
    ),
  );
}
