// 資料庫金鑰搬到 Keychain／Keystore 的一次性遷移。
//
// 這段的風險不是「搬不過去」，是「搬到一半把金鑰弄丟」——金鑰丟了，整個
// SQLCipher 資料庫就永遠打不開了。所以驗的重點是失敗路徑：驗證沒過就保留
// 舊金鑰，寧可留著明文也不要鎖死使用者的資料。
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/db/db_key_store.dart';

class FakeSecureStore implements DbKeyStore {
  FakeSecureStore({this.failWrite = false, this.readsBack = true});

  String? value;
  bool failWrite;

  /// 模擬「寫進去了但讀回來是空的」這種安全儲存故障。
  bool readsBack;

  int writeCount = 0;

  @override
  Future<String?> read() async => readsBack ? value : null;

  @override
  Future<void> write(String key) async {
    writeCount++;
    if (failWrite) throw Exception('安全儲存寫入失敗');
    value = key;
  }

  @override
  Future<void> delete() async => value = null;
}

class FakeLegacyStore implements LegacyDbKeyStore {
  FakeLegacyStore(this.value);
  String? value;
  bool deleted = false;

  @override
  Future<String?> read() async => value;

  @override
  Future<void> delete() async {
    deleted = true;
    value = null;
  }
}

void main() {
  group('ensureDbKey', () {
    test('安全儲存已有金鑰：直接用，不碰舊的 SharedPreferences', () async {
      final secure = FakeSecureStore()..value = 'existing-key';
      final legacy = FakeLegacyStore('legacy-key');

      final result = await ensureDbKey(secure: secure, legacy: legacy);

      expect(result.passphrase, 'existing-key');
      expect(result.origin, DbKeyOrigin.secureStorage);
      expect(secure.writeCount, 0);
      expect(legacy.deleted, isFalse);
      expect(legacy.value, 'legacy-key', reason: '不該去動它');
    });

    test('舊版金鑰：搬進安全儲存、驗證成功後刪掉明文', () async {
      final secure = FakeSecureStore();
      final legacy = FakeLegacyStore('legacy-key');

      final result = await ensureDbKey(secure: secure, legacy: legacy);

      expect(result.passphrase, 'legacy-key', reason: '金鑰值必須一模一樣，否則庫打不開');
      expect(result.origin, DbKeyOrigin.migratedFromLegacy);
      expect(secure.value, 'legacy-key');
      expect(legacy.deleted, isTrue, reason: '搬完必須刪掉明文');
    });

    test('遷移後讀回不一致：拋錯、保留明文、不刪舊金鑰', () async {
      final secure = FakeSecureStore(readsBack: false); // 寫得進去、讀不回來
      final legacy = FakeLegacyStore('legacy-key');

      await expectLater(
        ensureDbKey(secure: secure, legacy: legacy),
        throwsA(
          isA<DbKeyMigrationException>().having(
            (e) => e.message,
            'message',
            contains('資料庫未受影響'),
          ),
        ),
      );

      expect(legacy.deleted, isFalse, reason: '驗證沒過就不准刪明文');
      expect(legacy.value, 'legacy-key');
    });

    test('安全儲存寫入直接失敗：拋錯、舊金鑰原封不動', () async {
      final secure = FakeSecureStore(failWrite: true);
      final legacy = FakeLegacyStore('legacy-key');

      await expectLater(
        ensureDbKey(secure: secure, legacy: legacy),
        throwsA(isA<Exception>()),
      );
      expect(legacy.deleted, isFalse);
      expect(legacy.value, 'legacy-key');
    });

    test('全新安裝：產生 32 bytes 隨機金鑰，直接寫進安全儲存', () async {
      final secure = FakeSecureStore();
      final legacy = FakeLegacyStore(null);

      final result = await ensureDbKey(secure: secure, legacy: legacy);

      expect(result.origin, DbKeyOrigin.created);
      expect(result.passphrase, isNotEmpty);
      expect(secure.value, result.passphrase);
      expect(legacy.deleted, isFalse);
    });

    test('兩次全新安裝的金鑰不會一樣', () async {
      final a = await ensureDbKey(
        secure: FakeSecureStore(),
        legacy: FakeLegacyStore(null),
      );
      final b = await ensureDbKey(
        secure: FakeSecureStore(),
        legacy: FakeLegacyStore(null),
      );
      expect(a.passphrase, isNot(b.passphrase));
    });

    test('舊金鑰是空字串視同沒有，改產生新的', () async {
      final secure = FakeSecureStore();
      final legacy = FakeLegacyStore('');

      final result = await ensureDbKey(secure: secure, legacy: legacy);
      expect(result.origin, DbKeyOrigin.created);
      expect(result.passphrase, isNotEmpty);
    });
  });
}
