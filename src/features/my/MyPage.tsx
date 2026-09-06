import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '@/lib/useAsync';
import { faithService, MOCK_USER_ID } from '@/services';
import { LoadingState, ErrorState, EmptyState } from '@/components/StateViews';
import { Tabs } from '@/components/Tabs';
import { Card } from '@/components/Card';
import type { CeremonyType, HistoryEntry } from '@/domain/types';

type FilterValue = 'ALL' | CeremonyType;

const TYPE_LABEL: Record<CeremonyType, string> = {
  WORSHIP: '拜拜',
  FORTUNE: '籤',
  LAMP: '點燈',
  RITUAL: '儀式',
};

function entryHref(entry: HistoryEntry): string | null {
  if (entry.type === 'FORTUNE') return `/fortune/result/${entry.id}`;
  if (entry.type === 'LAMP') return '/lantern';
  return null;
}

export function MyPage() {
  const [filter, setFilter] = useState<FilterValue>('ALL');
  const historyAsync = useAsync(() => faithService.getHistory(MOCK_USER_ID), []);

  const filtered = useMemo(() => {
    if (historyAsync.status !== 'success') return [];
    if (filter === 'ALL') return historyAsync.data;
    return historyAsync.data.filter((entry) => entry.type === filter);
  }, [historyAsync, filter]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="font-display text-xl font-medium text-ink-900">我的信仰時光軸</h1>
      <p className="mt-1 text-sm text-ink-500">記錄您每一次的拜拜、求籤、點燈與儀式預約。</p>

      <div className="mt-4">
        <Tabs
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'ALL', label: '全部' },
            { value: 'WORSHIP', label: '我的祈願' },
            { value: 'FORTUNE', label: '我的籤' },
            { value: 'LAMP', label: '我的點燈' },
            { value: 'RITUAL', label: '我的儀式' },
          ]}
        />
      </div>

      <div className="mt-6">
        {historyAsync.status === 'loading' && <LoadingState label="載入信仰紀錄中…" />}
        {historyAsync.status === 'error' && <ErrorState message="無法載入紀錄" onRetry={historyAsync.retry} />}
        {historyAsync.status === 'success' && filtered.length === 0 && (
          <EmptyState
            title="這裡還沒有紀錄"
            description="從探索神明開始，您的每一次祈願都會被記錄在這裡。"
            action={
              <Link to="/explore" className="text-sm text-ink-700 underline underline-offset-4">
                前往探索
              </Link>
            }
          />
        )}
        {historyAsync.status === 'success' && filtered.length > 0 && (
          <ol className="flex flex-col gap-3 border-l border-ink-100 pl-4">
            {filtered.map((entry) => {
              const href = entryHref(entry);
              const content = (
                <Card className="p-4 transition-shadow hover:shadow-raised">
                  <div className="flex items-center justify-between">
                    <span className="rounded-sm bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600">
                      {TYPE_LABEL[entry.type]}
                    </span>
                    <span className="text-xs text-ink-400">
                      {new Date(entry.timestamp).toLocaleString('zh-TW')}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-ink-800">{entry.summary}</p>
                  {(entry.deityName || entry.templeName) && (
                    <p className="mt-1 text-xs text-ink-400">
                      {[entry.deityName, entry.templeName].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </Card>
              );
              return (
                <li key={entry.id} className="relative -ml-[21px]">
                  <span className="absolute left-[16px] top-6 h-2 w-2 rounded-full bg-ink-300" aria-hidden />
                  <div className="ml-6">{href ? <Link to={href}>{content}</Link> : content}</div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
