import 'dart:convert';
import 'dart:math';

import 'package:shared_preferences/shared_preferences.dart';

const String _dbPassphraseKey = 'db_passphrase_v1';

/// 產生（或讀回）本機資料庫加密密碼。示範用途：以安全隨機碼存於
/// SharedPreferences；正式產品建議改用平台安全儲存（Keychain / Keystore）。
/// 見 docs/ASSUMPTIONS.md §環境限制。
Future<String> ensureDbPassphrase(SharedPreferences prefs) async {
  final existing = prefs.getString(_dbPassphraseKey);
  if (existing != null && existing.isNotEmpty) return existing;

  final random = Random.secure();
  final bytes = List<int>.generate(32, (_) => random.nextInt(256));
  final passphrase = base64UrlEncode(bytes);
  await prefs.setString(_dbPassphraseKey, passphrase);
  return passphrase;
}
