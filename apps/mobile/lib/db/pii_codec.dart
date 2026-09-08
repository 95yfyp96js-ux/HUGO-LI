import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:encrypt/encrypt.dart' as enc;

/// 敏感欄位（身分證字號、完整地址、銀行帳號）的應用層加密／遮罩／查重工具
/// （見 spec §2 不變式 5、docs/ASSUMPTIONS.md §7）。
///
/// 密文格式：`<IV base64url>.<ciphertext base64url>`（AES-256-GCM）。
class PiiCodec {
  PiiCodec(this._key);

  factory PiiCodec.fromPassphrase(String passphrase) {
    final digest = sha256.convert(utf8.encode(passphrase));
    return PiiCodec(enc.Key(Uint8List.fromList(digest.bytes)));
  }

  final enc.Key _key;

  String encryptText(String plainText) {
    final iv = enc.IV.fromSecureRandom(12);
    final encrypter = enc.Encrypter(enc.AES(_key, mode: enc.AESMode.gcm));
    final encrypted = encrypter.encrypt(plainText, iv: iv);
    return '${base64Url.encode(iv.bytes)}.${base64Url.encode(encrypted.bytes)}';
  }

  String decryptText(String cipherText) {
    final parts = cipherText.split('.');
    final iv = enc.IV(base64Url.decode(parts[0]));
    final encrypter = enc.Encrypter(enc.AES(_key, mode: enc.AESMode.gcm));
    return encrypter.decrypt(enc.Encrypted(base64Url.decode(parts[1])), iv: iv);
  }

  /// 查重用雜湊（不明文比對，見不變式 5）。
  static String hashForDedup(String plainText) =>
      sha256.convert(utf8.encode(plainText.trim())).toString();

  /// 畫面遮罩：只顯示末 4 碼。
  static String maskTail4(String plainText) {
    if (plainText.length <= 4) return '*' * plainText.length;
    return '${'*' * (plainText.length - 4)}${plainText.substring(plainText.length - 4)}';
  }
}
