/// 授權狀態（見 docs/state-machines.md §3）。
enum LicenseState { trial, trialExhausted, licensed }

/// 依目前試用次數、是否已授權、是否為開發旁路（`--dart-define=DEV_LICENSE=1`）
/// 計算目前授權狀態。純函式。
LicenseState computeLicenseState({
  required int usedCount,
  required int freeLimit,
  required bool isLicensed,
  bool devOverride = false,
}) {
  if (devOverride || isLicensed) return LicenseState.licensed;
  if (usedCount >= freeLimit) return LicenseState.trialExhausted;
  return LicenseState.trial;
}
