import 'dart:convert';
import 'dart:math';

/// 資料庫金鑰的存放介面。
///
/// **金鑰絕對不可以再放進 SharedPreferences**：那是明文 XML／plist，root 過的
/// 裝置或有備份存取權的人可以直接讀走，等於整個 SQLCipher 加密形同虛設。
/// 正式 App 走 [SecureDbKeyStore]（Keychain / Keystore）；測試走假實作。
abstract class DbKeyStore {
  Future<String?> read();
  Future<void> write(String key);
  Future<void> delete();
}

/// 舊版把金鑰存在 SharedPreferences 的讀取／清除介面，只用於一次性遷移。
abstract class LegacyDbKeyStore {
  Future<String?> read();
  Future<void> delete();
}

class DbKeyMigrationException implements Exception {
  DbKeyMigrationException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// 遷移結果，供設定頁與稽核紀錄顯示。
enum DbKeyOrigin {
  /// 安全儲存本來就有金鑰，沒有動到任何東西。
  secureStorage,

  /// 從舊的 SharedPreferences 搬過來，且已刪除明文。
  migratedFromLegacy,

  /// 全新安裝，這次才產生金鑰。
  created,
}

class DbKeyResult {
  const DbKeyResult(this.passphrase, this.origin);
  final String passphrase;
  final DbKeyOrigin origin;
}

/// 取得資料庫金鑰，必要時做一次性遷移。
///
/// 順序：
/// 1. 安全儲存已有 → 直接用。
/// 2. 安全儲存沒有、舊的 SharedPreferences 有 → 搬進安全儲存，**讀回驗證成功**
///    才刪除明文；驗證失敗就保留明文並拋出例外（寧可留著也不要把使用者的庫
///    鎖死）。
/// 3. 兩邊都沒有 → 產生新的 32 bytes 隨機金鑰。
Future<DbKeyResult> ensureDbKey({
  required DbKeyStore secure,
  required LegacyDbKeyStore legacy,
}) async {
  final String? existing = await secure.read();
  if (existing != null && existing.isNotEmpty) {
    return DbKeyResult(existing, DbKeyOrigin.secureStorage);
  }

  final String? legacyKey = await legacy.read();
  if (legacyKey != null && legacyKey.isNotEmpty) {
    await secure.write(legacyKey);

    // 讀回驗證：確定安全儲存真的收下了，才敢刪明文。
    final String? verify = await secure.read();
    if (verify != legacyKey) {
      throw DbKeyMigrationException(
        '金鑰搬移到安全儲存後讀回不一致，已保留原本的金鑰，資料庫未受影響。'
        '請重開 App 再試一次；持續失敗請回報。',
      );
    }
    await legacy.delete();
    return DbKeyResult(legacyKey, DbKeyOrigin.migratedFromLegacy);
  }

  final random = Random.secure();
  final bytes = List<int>.generate(32, (_) => random.nextInt(256));
  final String created = base64UrlEncode(bytes);
  await secure.write(created);
  return DbKeyResult(created, DbKeyOrigin.created);
}
