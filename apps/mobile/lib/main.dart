import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app.dart';
import 'db/app_database.dart';
import 'db/connection.dart';
import 'db/passphrase.dart';
import 'db/pii_codec.dart';
import 'domain/loan_repository.dart';
import 'providers/app_providers.dart';

/// 開發旁路：`--dart-define=DEV_LICENSE=1`（見 spec §7）。
const bool kDevLicenseOverride = bool.fromEnvironment('DEV_LICENSE');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final prefs = await SharedPreferences.getInstance();
  final String dbPassphrase = await ensureDbPassphrase(prefs);
  final AppDatabase database = AppDatabase(
    openEncryptedConnection(passphrase: dbPassphrase),
  );
  final PiiCodec piiCodec = PiiCodec.fromPassphrase(dbPassphrase);

  // App 啟動即跑一次日結，補逾期判定（見 docs/interest-rules.md §5）。
  await LoanRepository(database).runDailyBatch();

  runApp(
    ProviderScope(
      overrides: [
        databaseProvider.overrideWithValue(database),
        sharedPreferencesProvider.overrideWithValue(prefs),
        piiCodecProvider.overrideWithValue(piiCodec),
        devLicenseOverrideProvider.overrideWithValue(kDevLicenseOverride),
      ],
      child: const LendingApp(),
    ),
  );
}
