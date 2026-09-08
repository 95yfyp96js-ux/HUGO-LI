import 'package:license/license.dart';
import 'package:test/test.dart';

void main() {
  final secretKey = 'demo-secret-key-do-not-use-in-prod'.codeUnits;
  final signer = LicenseSigner(secretKey);
  final verifier = LicenseVerifier(secretKey);

  group('LicenseSigner / LicenseVerifier（離線 HMAC-SHA256 簽章）', () {
    test('已綁定裝置的授權碼，同裝置驗證通過', () {
      final payload = LicensePayload(
        licenseId: 'LIC-0001',
        deviceId: 'device-abc',
        issuedAt: DateTime.utc(2026, 1, 1),
      );
      final code = signer.sign(payload);
      final result = verifier.verify(code, currentDeviceId: 'device-abc');

      expect(result.valid, isTrue);
      expect(result.payload?.licenseId, 'LIC-0001');
      expect(result.payload?.deviceId, 'device-abc');
      expect(result.deviceBoundNow, isFalse);
    });

    test('已綁定裝置的授權碼，換裝置驗證失敗（一機一碼）', () {
      final payload = LicensePayload(
        licenseId: 'LIC-0001',
        deviceId: 'device-abc',
        issuedAt: DateTime.utc(2026, 1, 1),
      );
      final code = signer.sign(payload);
      final result = verifier.verify(code, currentDeviceId: 'device-xyz');

      expect(result.valid, isFalse);
      expect(result.reason, LicenseInvalidReason.deviceMismatch);
    });

    test('未綁定裝置的授權碼，首次啟用即綁定目前裝置', () {
      final payload = LicensePayload(
        licenseId: 'LIC-0002',
        deviceId: '',
        issuedAt: DateTime.utc(2026, 1, 1),
      );
      final code = signer.sign(payload);
      final result = verifier.verify(code, currentDeviceId: 'device-first');

      expect(result.valid, isTrue);
      expect(result.deviceBoundNow, isTrue);
      expect(result.payload?.deviceId, 'device-first');
    });

    test('遭竄改的授權碼驗證失敗', () {
      final payload = LicensePayload(
        licenseId: 'LIC-0003',
        deviceId: 'device-abc',
        issuedAt: DateTime.utc(2026, 1, 1),
      );
      final code = signer.sign(payload);
      final tampered = '${code.substring(0, code.length - 1)}0';
      final result = verifier.verify(tampered, currentDeviceId: 'device-abc');

      expect(result.valid, isFalse);
      expect(result.reason, LicenseInvalidReason.signatureMismatch);
    });

    test('用錯誤金鑰簽的碼驗證失敗', () {
      final wrongSigner = LicenseSigner('wrong-key'.codeUnits);
      final payload = LicensePayload(
        licenseId: 'LIC-0004',
        deviceId: 'device-abc',
        issuedAt: DateTime.utc(2026, 1, 1),
      );
      final code = wrongSigner.sign(payload);
      final result = verifier.verify(code, currentDeviceId: 'device-abc');

      expect(result.valid, isFalse);
      expect(result.reason, LicenseInvalidReason.signatureMismatch);
    });

    test('格式錯誤的字串驗證失敗，不拋例外', () {
      final result =
          verifier.verify('not-a-valid-code', currentDeviceId: 'device-abc');
      expect(result.valid, isFalse);
      expect(result.reason, LicenseInvalidReason.malformed);
    });

    test('過期授權碼驗證失敗', () {
      final payload = LicensePayload(
        licenseId: 'LIC-0005',
        deviceId: 'device-abc',
        issuedAt: DateTime.utc(2026, 1, 1),
        expiresAt: DateTime.utc(2026, 2, 1),
      );
      final code = signer.sign(payload);
      final result = verifier.verify(
        code,
        currentDeviceId: 'device-abc',
        now: DateTime.utc(2026, 3, 1),
      );
      expect(result.valid, isFalse);
      expect(result.reason, LicenseInvalidReason.expired);
    });

    test('未過期授權碼在到期前驗證通過', () {
      final payload = LicensePayload(
        licenseId: 'LIC-0006',
        deviceId: 'device-abc',
        issuedAt: DateTime.utc(2026, 1, 1),
        expiresAt: DateTime.utc(2026, 2, 1),
      );
      final code = signer.sign(payload);
      final result = verifier.verify(
        code,
        currentDeviceId: 'device-abc',
        now: DateTime.utc(2026, 1, 15),
      );
      expect(result.valid, isTrue);
    });
  });

  group('DeviceIdProvider', () {
    test('FixedDeviceIdProvider 回傳固定值', () {
      const provider = FixedDeviceIdProvider('abc-123');
      expect(provider.currentDeviceId(), 'abc-123');
    });
  });
}
