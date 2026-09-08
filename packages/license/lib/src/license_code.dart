import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:meta/meta.dart';

/// 授權碼內嵌的資料（見 docs/ASSUMPTIONS.md §6：離線 HMAC-SHA256 簽章）。
@immutable
class LicensePayload {
  const LicensePayload({
    required this.licenseId,
    required this.deviceId,
    required this.issuedAt,
    this.expiresAt,
  });

  final String licenseId;

  /// 綁定的裝置代碼；空字串代表「尚未綁定，首次啟用即綁定」。
  final String deviceId;
  final DateTime issuedAt;
  final DateTime? expiresAt;

  String _serialize() {
    final issuedMs = issuedAt.toUtc().millisecondsSinceEpoch;
    final expiresMs = expiresAt?.toUtc().millisecondsSinceEpoch ?? 0;
    return '$licenseId|$deviceId|$issuedMs|$expiresMs';
  }

  static LicensePayload _deserialize(String raw) {
    final parts = raw.split('|');
    if (parts.length != 4) {
      throw const FormatException('授權碼內容格式錯誤');
    }
    final issuedMs = int.parse(parts[2]);
    final expiresMs = int.parse(parts[3]);
    return LicensePayload(
      licenseId: parts[0],
      deviceId: parts[1],
      issuedAt: DateTime.fromMillisecondsSinceEpoch(issuedMs, isUtc: true),
      expiresAt: expiresMs == 0
          ? null
          : DateTime.fromMillisecondsSinceEpoch(expiresMs, isUtc: true),
    );
  }

  LicensePayload copyWith({String? deviceId}) => LicensePayload(
        licenseId: licenseId,
        deviceId: deviceId ?? this.deviceId,
        issuedAt: issuedAt,
        expiresAt: expiresAt,
      );
}

String _b64UrlEncode(List<int> bytes) =>
    base64Url.encode(bytes).replaceAll('=', '');

List<int> _b64UrlDecode(String s) {
  final padded = s.padRight((s.length + 3) ~/ 4 * 4, '=');
  return base64Url.decode(padded);
}

/// 供出借人／供應端離線簽發授權碼（示範用途，非正式金鑰管理，見
/// docs/ASSUMPTIONS.md §6）。
@immutable
class LicenseSigner {
  const LicenseSigner(this.secretKey);

  final List<int> secretKey;

  /// 產生授權碼字串：`<payload base64url>.<HMAC-SHA256 hex>`。
  String sign(LicensePayload payload) {
    final raw = payload._serialize();
    final payloadB64 = _b64UrlEncode(utf8.encode(raw));
    final mac = Hmac(sha256, secretKey).convert(utf8.encode(raw));
    return '$payloadB64.${mac.toString()}';
  }
}

enum LicenseInvalidReason {
  malformed,
  signatureMismatch,
  deviceMismatch,
  expired
}

/// 驗證結果。[valid] 為 false 時 [reason] 說明原因。
@immutable
class LicenseVerificationResult {
  const LicenseVerificationResult._({
    required this.valid,
    this.payload,
    this.reason,
    this.deviceBoundNow = false,
  });

  const LicenseVerificationResult.valid(LicensePayload payload,
      {bool deviceBoundNow = false})
      : this._(valid: true, payload: payload, deviceBoundNow: deviceBoundNow);

  const LicenseVerificationResult.invalid(LicenseInvalidReason reason)
      : this._(valid: false, reason: reason);

  final bool valid;
  final LicensePayload? payload;
  final LicenseInvalidReason? reason;

  /// 此次驗證是否為「首次啟用即綁定裝置」（payload 原本未綁定裝置）。
  final bool deviceBoundNow;
}

/// 在裝置端離線驗證授權碼，並落實「一機一碼」（見 docs/ASSUMPTIONS.md §9）。
@immutable
class LicenseVerifier {
  const LicenseVerifier(this.secretKey);

  final List<int> secretKey;

  LicenseVerificationResult verify(
    String code, {
    required String currentDeviceId,
    DateTime? now,
  }) {
    final parts = code.split('.');
    if (parts.length != 2) {
      return const LicenseVerificationResult.invalid(
          LicenseInvalidReason.malformed);
    }
    final String payloadB64 = parts[0];
    final String signatureHex = parts[1];

    late final List<int> rawBytes;
    try {
      rawBytes = _b64UrlDecode(payloadB64);
    } on FormatException {
      return const LicenseVerificationResult.invalid(
          LicenseInvalidReason.malformed);
    }

    final expectedMac = Hmac(sha256, secretKey).convert(rawBytes).toString();
    if (expectedMac != signatureHex) {
      return const LicenseVerificationResult.invalid(
          LicenseInvalidReason.signatureMismatch);
    }

    final LicensePayload payload;
    try {
      payload = LicensePayload._deserialize(utf8.decode(rawBytes));
    } on FormatException {
      return const LicenseVerificationResult.invalid(
          LicenseInvalidReason.malformed);
    }

    final DateTime asOf = now ?? DateTime.now();
    if (payload.expiresAt != null && asOf.isAfter(payload.expiresAt!)) {
      return const LicenseVerificationResult.invalid(
          LicenseInvalidReason.expired);
    }

    if (payload.deviceId.isEmpty) {
      // 首次啟用：綁定到目前裝置。
      return LicenseVerificationResult.valid(
        payload.copyWith(deviceId: currentDeviceId),
        deviceBoundNow: true,
      );
    }

    if (payload.deviceId != currentDeviceId) {
      return const LicenseVerificationResult.invalid(
          LicenseInvalidReason.deviceMismatch);
    }

    return LicenseVerificationResult.valid(payload);
  }
}
