// 授權閘門（spec §7、C7）。此版本授權是**示範等級**，這裡驗的是它至少要誠實：
// 沒帶簽章密鑰的 build 不可以假裝驗得過，10 次試用要真的擋得住。
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:license/license.dart' as license;
import 'package:mobile/db/app_database.dart';
import 'package:mobile/domain/license_repository.dart';

class _FixedDeviceId implements license.DeviceIdProvider {
  @override
  String currentDeviceId() => 'device-under-test';
}

LicenseRepository _repo(AppDatabase db, {bool devOverride = false}) =>
    LicenseRepository(db, _FixedDeviceId(), devOverride: devOverride);

void main() {
  test('測試 build 沒有帶 LICENSE_HMAC_KEY：簽章能力關閉', () {
    expect(
      licenseSigningConfigured,
      isFalse,
      reason: '沒有 --dart-define=LICENSE_HMAC_KEY 就不該有授權能力',
    );
  });

  test('沒有簽章密鑰時，任何授權碼都驗不過（不會誤放行）', () async {
    final db = AppDatabase(NativeDatabase.memory());
    final repo = _repo(db);

    for (final code in ['', ' ', 'abc', 'payload.signature', 'DEMO-1234']) {
      final result = await repo.activate(code);
      expect(result.valid, isFalse, reason: '「$code」不該通過');
    }
    expect(await repo.currentState(), license.LicenseState.trial);

    await db.close();
  });

  test('免費試用 10 次寫入，第 11 次擋下且不執行動作', () async {
    final db = AppDatabase(NativeDatabase.memory());
    final repo = _repo(db);

    expect(await repo.remaining(), 10);

    int executed = 0;
    for (int i = 1; i <= 10; i++) {
      await repo.performGatedWrite(() async => executed++);
      expect(await repo.remaining(), 10 - i, reason: '第 $i 次之後');
    }
    expect(executed, 10);
    expect(await repo.currentState(), license.LicenseState.trialExhausted);

    await expectLater(
      repo.performGatedWrite(() async => executed++),
      throwsA(isA<TrialExhaustedException>()),
    );
    expect(executed, 10, reason: '被擋下時不可以順手把動作做掉');

    await db.close();
  });

  test('DEV_LICENSE 開發旁路：不計次、不受限（僅供開發，設定頁會標示）', () async {
    final db = AppDatabase(NativeDatabase.memory());
    final repo = _repo(db, devOverride: true);

    for (int i = 0; i < 20; i++) {
      await repo.performGatedWrite(() async => null);
    }
    expect(await repo.currentState(), license.LicenseState.licensed);

    // 同一個資料庫換成沒有旁路的 repository，次數應該還是 0 ——
    // 旁路不計次，關掉旁路後試用額度完好。
    final plain = _repo(db);
    expect(await plain.remaining(), 10);

    await db.close();
  });
}
