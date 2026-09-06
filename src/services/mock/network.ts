/**
 * 模擬真實網路延遲，讓 Loading 狀態在原型中是真實可測試的，而不是假的即時回應。
 * 見 QA_REPORT.md 的 Loading/Error 測試需求。
 */
export function mockDelay(minMs = 150, maxMs = 420): Promise<void> {
  const ms = Math.random() * (maxMs - minMs) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockNetworkError extends Error {
  constructor(message = '網路連線異常，請稍後再試。') {
    super(message);
    this.name = 'MockNetworkError';
  }
}

let failureInjectionEnabled = false;

/** QA 測試用：開關「模擬失敗」以驗證 Error/Retry 狀態。 */
export function setMockFailureInjection(enabled: boolean): void {
  failureInjectionEnabled = enabled;
}

export function maybeThrowMockFailure(rate = 0.0): void {
  if (failureInjectionEnabled && Math.random() < Math.max(rate, 0.5)) {
    throw new MockNetworkError();
  }
}
