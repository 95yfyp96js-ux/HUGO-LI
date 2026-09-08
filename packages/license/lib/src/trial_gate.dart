import 'package:meta/meta.dart';

import 'license_state.dart';

/// 試用鎖：未啟用可操作，但「新增貸款」與「確認撥款」兩個計入次數的寫入
/// 動作累計達 [freeLimit]（預設 10）次後鎖定（見 spec §7）。
@immutable
class TrialGate {
  const TrialGate({this.freeLimit = 10}) : assert(freeLimit > 0);

  final int freeLimit;

  /// 是否仍可執行一次計入次數的寫入動作。
  bool canPerformGatedWrite({
    required int usedCount,
    required bool isLicensed,
    bool devOverride = false,
  }) {
    final state = computeLicenseState(
      usedCount: usedCount,
      freeLimit: freeLimit,
      isLicensed: isLicensed,
      devOverride: devOverride,
    );
    return state != LicenseState.trialExhausted;
  }

  /// 剩餘可用次數；已授權／開發旁路回傳 -1（代表無限制）。
  int remaining({
    required int usedCount,
    required bool isLicensed,
    bool devOverride = false,
  }) {
    if (devOverride || isLicensed) return -1;
    final int r = freeLimit - usedCount;
    return r < 0 ? 0 : r;
  }
}
