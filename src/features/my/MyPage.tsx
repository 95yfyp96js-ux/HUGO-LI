import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '@/lib/useAsync';
import { faithService, MOCK_USER_ID } from '@/services';
import { LoadingState, ErrorState, EmptyState } from '@/components/StateViews';
import { Tabs } from '@/components/Tabs';
import { PageScreen, PageHeading } from '@/components/screens';
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
    <PageScreen>
      <PageHeading title="信仰時光軸" description="您每一次的拜拜、求籤、點燈與儀式預約。" />

      <Tabs
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'ALL', label: '全部' },
          { value: 'WORSHIP', label: '祈願' },
          { value: 'FORTUNE', label: '籤' },
          { value: 'LAMP', label: '點燈' },
          { value: 'RITUAL', label: '儀式' },
        ]}
      />

      <div className="mt-10">
        {historyAsync.status === 'loading' && <LoadingState label="載入中" />}
        {historyAsync.status === 'error' && <ErrorState message="無法載入紀錄" onRetry={historyAsync.retry} />}
        {historyAsync.status === 'success' && filtered.length === 0 && (
          <EmptyState
            title="這裡還沒有紀錄"
            description="從探索神明開始，您的每一次祈願都會被記錄在這裡。"
            action={
              <Link to="/explore" className="text-[13px] text-ash-300 transition-colors hover:text-ash-100">
                前往探索
              </Link>
            }
          />
        )}

        {/* 時光軸：一條垂直的線，每個節點是一個被記下來的時刻 */}
        {historyAsync.status === 'success' && filtered.length > 0 && (
          <ol className="border-l border-void-line">
            {filtered.map((entry) => {
              const href = entryHref(entry);
              const body = (
                <>
                  <div className="flex items-baseline gap-4">
                    <span className="text-[11px] tracking-wide text-ash-700">
                      {TYPE_LABEL[entry.type]}
                    </span>
                    <span className="text-[11px] text-ash-700">
                      {new Date(entry.timestamp).toLocaleString('zh-TW')}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-ash-300">{entry.summary}</p>
                  {(entry.deityName || entry.templeName) && (
                    <p className="mt-2 text-[11px] text-ash-700">
                      {[entry.deityName, entry.templeName].filter(Boolean).join('　')}
                    </p>
                  )}
                </>
              );
              return (
                <li key={entry.id} className="relative py-7 pl-8">
                  <span
                    className="absolute -left-[3px] top-[2.4rem] h-1.5 w-1.5 rounded-full bg-ash-700"
                    aria-hidden
                  />
                  {href ? (
                    <Link to={href} className="group block">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </PageScreen>
  );
}
