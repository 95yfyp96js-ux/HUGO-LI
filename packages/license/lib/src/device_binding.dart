/// 裝置識別碼提供者。Flutter 端由 app 層實作（例如結合安裝時產生並持久化
/// 的 UUID）；測試端可用固定字串的假實作（見 docs/ASSUMPTIONS.md §6）。
abstract class DeviceIdProvider {
  String currentDeviceId();
}

/// 測試／開發用：固定回傳同一組裝置代碼。
class FixedDeviceIdProvider implements DeviceIdProvider {
  const FixedDeviceIdProvider(this.deviceId);

  final String deviceId;

  @override
  String currentDeviceId() => deviceId;
}
