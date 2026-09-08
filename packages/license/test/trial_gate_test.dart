import 'package:license/license.dart';
import 'package:test/test.dart';

void main() {
  group('TrialGate', () {
    const gate = TrialGate(freeLimit: 10);

    test('第 1~10 次寫入皆允許', () {
      for (var used = 0; used < 10; used++) {
        expect(
          gate.canPerformGatedWrite(usedCount: used, isLicensed: false),
          isTrue,
          reason: 'usedCount=$used',
        );
      }
    });

    test('第 11 次（累計滿 10 次後）鎖定', () {
      expect(
          gate.canPerformGatedWrite(usedCount: 10, isLicensed: false), isFalse);
    });

    test('已授權不受次數限制', () {
      expect(
          gate.canPerformGatedWrite(usedCount: 999, isLicensed: true), isTrue);
    });

    test('DEV_LICENSE 旁路不受次數限制', () {
      expect(
        gate.canPerformGatedWrite(
            usedCount: 999, isLicensed: false, devOverride: true),
        isTrue,
      );
    });

    test('remaining 正確遞減', () {
      expect(gate.remaining(usedCount: 0, isLicensed: false), 10);
      expect(gate.remaining(usedCount: 7, isLicensed: false), 3);
      expect(gate.remaining(usedCount: 10, isLicensed: false), 0);
      expect(gate.remaining(usedCount: 15, isLicensed: false), 0); // 不為負
    });

    test('已授權／開發旁路 remaining 回傳 -1（無限制標記）', () {
      expect(gate.remaining(usedCount: 5, isLicensed: true), -1);
      expect(gate.remaining(usedCount: 5, isLicensed: false, devOverride: true),
          -1);
    });
  });
}
