import 'dart:async';
import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:license/license.dart' as license;
import 'package:shared_preferences/shared_preferences.dart';

import '../db/app_database.dart';
import 'id_gen.dart';

/// 授權簽章密鑰：由建置時傳入 `--dart-define=LICENSE_HMAC_KEY=...`。
///
/// **沒有傳入時 [licenseSigningConfigured] 為 false，所有授權碼一律驗不過**，
/// App 停留在 10 次試用模式。這是刻意的：與其在原始碼裡放一組人人拿得到的
/// 「示範密鑰」讓人誤以為有保護，不如明說這個 build 根本沒有授權能力。
///
/// 即使有傳入，這仍然是**示範等級**：密鑰會被打進 App 二進位檔，反編譯就能
/// 取出並自簽授權碼。禁止當成正式收費閘門（設定頁有同樣的告知）。
const String _licenseHmacKey = String.fromEnvironment('LICENSE_HMAC_KEY');

bool get licenseSigningConfigured => _licenseHmacKey.isNotEmpty;

List<int> get _licenseSecretKey => utf8.encode(_licenseHmacKey);

class TrialExhaustedException implements Exception {
  @override
  String toString() => '試用次數已用盡，請於設定頁輸入授權碼';
}

/// 以 SharedPreferences 持久化裝置代碼（見 docs/ASSUMPTIONS.md §6：無
/// device_info_plus 原生外掛可用時的替代方案）。
class PersistedDeviceIdProvider implements license.DeviceIdProvider {
  PersistedDeviceIdProvider(this._prefs);

  static const String _key = 'device_id';
  final SharedPreferences _prefs;

  @override
  String currentDeviceId() {
    String? id = _prefs.getString(_key);
    if (id == null) {
      id = newId();
      unawaited(_prefs.setString(_key, id));
    }
    return id;
  }
}

/// 授權（試用次數、裝置綁定、授權碼）（見 spec §7、docs/state-machines.md §3）。
class LicenseRepository {
  LicenseRepository(
    this._db,
    this._deviceIdProvider, {
    this.devOverride = false,
  });

  static const String _rowId = 'singleton';
  static const license.TrialGate trialGate = license.TrialGate(freeLimit: 10);

  final AppDatabase _db;
  final license.DeviceIdProvider _deviceIdProvider;

  /// 對應 `--dart-define=DEV_LICENSE=1`（見 spec §7）。
  final bool devOverride;

  Future<AppLicenseRow> _ensureRow() async {
    final existing = await (_db.select(
      _db.appLicenseRows,
    )..where((t) => t.id.equals(_rowId))).getSingleOrNull();
    if (existing != null) return existing;
    await _db
        .into(_db.appLicenseRows)
        .insert(
          AppLicenseRowsCompanion.insert(id: _rowId, updatedAt: DateTime.now()),
        );
    return (await (_db.select(
      _db.appLicenseRows,
    )..where((t) => t.id.equals(_rowId))).getSingle());
  }

  Stream<AppLicenseRow> watch() {
    unawaited(_ensureRow());
    return (_db.select(
      _db.appLicenseRows,
    )..where((t) => t.id.equals(_rowId))).watchSingle();
  }

  Future<license.LicenseState> currentState() async {
    final row = await _ensureRow();
    return license.computeLicenseState(
      usedCount: row.usedCount,
      freeLimit: trialGate.freeLimit,
      isLicensed: row.isLicensed,
      devOverride: devOverride,
    );
  }

  Future<int> remaining() async {
    final row = await _ensureRow();
    return trialGate.remaining(
      usedCount: row.usedCount,
      isLicensed: row.isLicensed,
      devOverride: devOverride,
    );
  }

  /// 輸入授權碼啟用（離線 HMAC 驗證＋一機一碼，見 docs/ASSUMPTIONS.md §6、§9）。
  Future<license.LicenseVerificationResult> activate(String code) async {
    if (!licenseSigningConfigured) {
      // 這個 build 沒有帶入簽章密鑰，任何授權碼都不可能是有效的。
      return const license.LicenseVerificationResult.invalid(
        license.LicenseInvalidReason.signatureMismatch,
      );
    }
    final verifier = license.LicenseVerifier(_licenseSecretKey);
    final String deviceId = _deviceIdProvider.currentDeviceId();
    final result = verifier.verify(code.trim(), currentDeviceId: deviceId);
    if (result.valid) {
      await _ensureRow();
      await (_db.update(
        _db.appLicenseRows,
      )..where((t) => t.id.equals(_rowId))).write(
        AppLicenseRowsCompanion(
          licenseCode: Value(code.trim()),
          licenseId: Value(result.payload!.licenseId),
          deviceId: Value(result.payload!.deviceId),
          isLicensed: const Value(true),
          updatedAt: Value(DateTime.now()),
        ),
      );
    }
    return result;
  }

  /// 執行一次計入試用次數的寫入動作（新增貸款／確認撥款，見 spec §7）。
  /// 次數已滿且尚未授權時拋出 [TrialExhaustedException]，不執行 [action]。
  Future<T> performGatedWrite<T>(Future<T> Function() action) async {
    final row = await _ensureRow();
    final bool canWrite = trialGate.canPerformGatedWrite(
      usedCount: row.usedCount,
      isLicensed: row.isLicensed,
      devOverride: devOverride,
    );
    if (!canWrite) throw TrialExhaustedException();

    final T result = await action();

    if (!devOverride && !row.isLicensed) {
      await (_db.update(
        _db.appLicenseRows,
      )..where((t) => t.id.equals(_rowId))).write(
        AppLicenseRowsCompanion(
          usedCount: Value(row.usedCount + 1),
          updatedAt: Value(DateTime.now()),
        ),
      );
    }
    return result;
  }
}
