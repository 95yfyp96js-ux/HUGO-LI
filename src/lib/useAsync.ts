import { useCallback, useEffect, useState } from 'react';

type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'success'; data: T };

/**
 * 統一的 Loading/Error/Success 狀態管理，搭配 mock service 的模擬延遲與錯誤注入使用。
 * 見 QA_REPORT.md：每個資料頁面都必須能展示 Loading/Error/Retry/Success 四態。
 */
export function useAsync<T>(fetcher: () => Promise<T>, deps: unknown[]): AsyncState<T> & { retry: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetcher()
      .then((data) => {
        if (!cancelled) setState({ status: 'success', data });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', error: error instanceof Error ? error : new Error('未知錯誤') });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  useEffect(() => load(), [load]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  return { ...state, retry } as AsyncState<T> & { retry: () => void };
}
