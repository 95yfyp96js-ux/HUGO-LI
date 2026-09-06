/**
 * 本機持久化（localStorage）——模擬「使用者產生的資料」（祈願/點燈/儀式預約/信仰紀錄）
 * 在沒有真實後端/會員系統時仍可跨重新整理保留，讓「我的紀錄」這個核心差異化功能可被實際體驗與測試。
 * 未來接入真實後端時，這層會被 Real API 實作取代，介面（FaithService）不需變動。
 */
const NAMESPACE = 'faith-platform:mock:';

export function readList<T>(key: string): T[] {
  try {
    const raw = window.localStorage.getItem(NAMESPACE + key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function writeList<T>(key: string, items: T[]): void {
  try {
    window.localStorage.setItem(NAMESPACE + key, JSON.stringify(items));
  } catch {
    // 寫入失敗（例如私密瀏覽模式）不應中斷核心流程，僅代表本次紀錄不會被保存。
  }
}

export function appendItem<T>(key: string, item: T): void {
  const items = readList<T>(key);
  items.push(item);
  writeList(key, items);
}

export const MOCK_USER_ID = 'mock-user-1';
