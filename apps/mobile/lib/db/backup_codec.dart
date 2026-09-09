import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:encrypt/encrypt.dart' as enc;

/// 備份檔格式（`.slbak`）
///
/// 外層是 JSON 信封（純文字，方便看得出這是什麼檔、版本對不對），內容是
/// AES-256-GCM 密文：
///
/// ```json
/// {
///   "format": "SLOS-BACKUP",
///   "version": 1,
///   "createdAt": "2026-09-09T...",
///   "kdf": { "algorithm": "PBKDF2-HMAC-SHA256", "salt": "...", "iterations": 150000 },
///   "iv": "...",
///   "payload": "<base64 ciphertext>"
/// }
/// ```
///
/// 口令錯誤會在 GCM 驗證階段就失敗（拋 [BackupPassphraseException]），不會解出
/// 半套垃圾資料，所以「口令錯 → 現庫不動」是靠密碼學保證，不是靠事後檢查。
const String kBackupFormat = 'SLOS-BACKUP';
const int kBackupVersion = 1;
const int kDefaultPbkdf2Iterations = 150000;

sealed class BackupException implements Exception {
  const BackupException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// 檔案不是備份檔、或內容毀損。
class BackupFormatException extends BackupException {
  const BackupFormatException([super.message = '這個檔案不是本 App 的備份檔，或內容已毀損。']);
}

/// 備份檔版本比目前 App 新（或不認得）。
class BackupVersionException extends BackupException {
  const BackupVersionException(super.message);
}

/// 口令錯誤（或檔案被竄改）。
class BackupPassphraseException extends BackupException {
  const BackupPassphraseException([super.message = '口令錯誤，或備份檔已被竄改。現有資料未變動。']);
}

/// PBKDF2-HMAC-SHA256。純 Dart 實作，沒有額外原生相依，測試跑得動。
Uint8List pbkdf2({
  required String passphrase,
  required Uint8List salt,
  required int iterations,
  int keyLength = 32,
}) {
  final hmac = Hmac(sha256, utf8.encode(passphrase));
  final int blocks = (keyLength / 32).ceil();
  final out = BytesBuilder();

  for (int block = 1; block <= blocks; block++) {
    final blockIndex = Uint8List(4)
      ..[0] = (block >> 24) & 0xff
      ..[1] = (block >> 16) & 0xff
      ..[2] = (block >> 8) & 0xff
      ..[3] = block & 0xff;

    var u = Uint8List.fromList(hmac.convert([...salt, ...blockIndex]).bytes);
    final acc = Uint8List.fromList(u);
    for (int i = 1; i < iterations; i++) {
      u = Uint8List.fromList(hmac.convert(u).bytes);
      for (int j = 0; j < acc.length; j++) {
        acc[j] ^= u[j];
      }
    }
    out.add(acc);
  }
  return Uint8List.fromList(out.toBytes().sublist(0, keyLength));
}

/// 把備份內容加密成可存檔的字串。
String encodeBackup({
  required Map<String, dynamic> content,
  required String passphrase,
  int iterations = kDefaultPbkdf2Iterations,
  DateTime? createdAt,
  Random? random,
}) {
  if (passphrase.isEmpty) {
    throw const BackupPassphraseException('請設定備份口令，還原時需要用到。');
  }
  final rnd = random ?? Random.secure();
  final salt = Uint8List.fromList(List.generate(16, (_) => rnd.nextInt(256)));
  final ivBytes = Uint8List.fromList(
    List.generate(12, (_) => rnd.nextInt(256)),
  );

  final key = enc.Key(
    pbkdf2(passphrase: passphrase, salt: salt, iterations: iterations),
  );
  final encrypter = enc.Encrypter(enc.AES(key, mode: enc.AESMode.gcm));
  final encrypted = encrypter.encrypt(jsonEncode(content), iv: enc.IV(ivBytes));

  return const JsonEncoder.withIndent('  ').convert({
    'format': kBackupFormat,
    'version': kBackupVersion,
    'createdAt': (createdAt ?? DateTime.now()).toIso8601String(),
    'kdf': {
      'algorithm': 'PBKDF2-HMAC-SHA256',
      'salt': base64.encode(salt),
      'iterations': iterations,
    },
    'iv': base64.encode(ivBytes),
    'payload': base64.encode(encrypted.bytes),
  });
}

/// 解開備份檔。失敗一律拋 [BackupException] 的子類，呼叫端據此顯示明確訊息。
Map<String, dynamic> decodeBackup({
  required String armored,
  required String passphrase,
}) {
  final Map<String, dynamic> envelope;
  try {
    final decoded = jsonDecode(armored);
    if (decoded is! Map<String, dynamic>) throw const FormatException();
    envelope = decoded;
  } on FormatException {
    throw const BackupFormatException();
  }

  if (envelope['format'] != kBackupFormat) {
    throw const BackupFormatException();
  }
  final version = envelope['version'];
  if (version is! int) throw const BackupFormatException();
  if (version > kBackupVersion) {
    throw BackupVersionException(
      '這個備份檔是較新版本（v$version）建立的，目前 App 只支援到 v$kBackupVersion。'
      '請先更新 App 再還原。現有資料未變動。',
    );
  }

  final Uint8List salt;
  final Uint8List iv;
  final Uint8List payload;
  final int iterations;
  try {
    final kdf = envelope['kdf'] as Map<String, dynamic>;
    salt = base64.decode(kdf['salt'] as String);
    iterations = kdf['iterations'] as int;
    iv = base64.decode(envelope['iv'] as String);
    payload = base64.decode(envelope['payload'] as String);
  } catch (_) {
    throw const BackupFormatException();
  }
  if (iterations <= 0) throw const BackupFormatException();

  final key = enc.Key(
    pbkdf2(passphrase: passphrase, salt: salt, iterations: iterations),
  );
  final encrypter = enc.Encrypter(enc.AES(key, mode: enc.AESMode.gcm));

  final String plain;
  try {
    plain = encrypter.decrypt(enc.Encrypted(payload), iv: enc.IV(iv));
  } catch (_) {
    // GCM 驗證失敗：口令錯或檔案被動過手腳。
    throw const BackupPassphraseException();
  }

  try {
    final decoded = jsonDecode(plain);
    if (decoded is! Map<String, dynamic>) throw const FormatException();
    return decoded;
  } on FormatException {
    throw const BackupFormatException();
  }
}
