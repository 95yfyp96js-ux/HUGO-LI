import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'db_key_store.dart';

/// 正式實作：iOS Keychain / Android Keystore（EncryptedSharedPreferences）。
class SecureDbKeyStore implements DbKeyStore {
  const SecureDbKeyStore(this._storage);

  static const String key = 'db_passphrase_v1';

  static const FlutterSecureStorage defaultStorage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read() => _storage.read(key: key);

  @override
  Future<void> write(String value) => _storage.write(key: key, value: value);

  @override
  Future<void> delete() => _storage.delete(key: key);
}

/// 舊版存放位置（明文 SharedPreferences）。只讀與刪，永不再寫入。
class LegacyPrefsDbKeyStore implements LegacyDbKeyStore {
  const LegacyPrefsDbKeyStore(this._prefs);

  static const String key = 'db_passphrase_v1';

  final SharedPreferences _prefs;

  @override
  Future<String?> read() async => _prefs.getString(key);

  @override
  Future<void> delete() async => _prefs.remove(key);
}
