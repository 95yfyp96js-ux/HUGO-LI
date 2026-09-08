import 'package:license/license.dart';
import 'package:test/test.dart';

void main() {
  group('computeLicenseState', () {
    test('未達上限為 trial', () {
      expect(
        computeLicenseState(usedCount: 3, freeLimit: 10, isLicensed: false),
        LicenseState.trial,
      );
    });

    test('達上限為 trialExhausted', () {
      expect(
        computeLicenseState(usedCount: 10, freeLimit: 10, isLicensed: false),
        LicenseState.trialExhausted,
      );
    });

    test('超過上限仍為 trialExhausted', () {
      expect(
        computeLicenseState(usedCount: 99, freeLimit: 10, isLicensed: false),
        LicenseState.trialExhausted,
      );
    });

    test('已授權即為 licensed，即使次數已用盡', () {
      expect(
        computeLicenseState(usedCount: 99, freeLimit: 10, isLicensed: true),
        LicenseState.licensed,
      );
    });

    test('DEV_LICENSE 旁路直接視為 licensed，不消耗次數判斷', () {
      expect(
        computeLicenseState(
          usedCount: 0,
          freeLimit: 10,
          isLicensed: false,
          devOverride: true,
        ),
        LicenseState.licensed,
      );
    });

    test('授權為終態語意：一旦 licensed 不會因次數變化改變（呼叫端固定 isLicensed=true 即可驗證）', () {
      final s1 =
          computeLicenseState(usedCount: 0, freeLimit: 10, isLicensed: true);
      final s2 =
          computeLicenseState(usedCount: 50, freeLimit: 10, isLicensed: true);
      expect(s1, LicenseState.licensed);
      expect(s2, LicenseState.licensed);
    });
  });
}
