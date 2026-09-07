import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Tabs } from '@/components/Tabs';
import { SourceBadge } from '@/components/SourceBadge';
import { LoadingState, ErrorState, EmptyState } from '@/components/StateViews';
import { PageScreen, PageHeading } from '@/components/screens';
import { useAsync } from '@/lib/useAsync';
import { faithService } from '@/services';
import type { DeityDomain } from '@/domain/types';

export function ExplorePage() {
  const [tab, setTab] = useState<'deities' | 'temples'>('deities');
  const [params] = useSearchParams();
  const needFilter = params.get('need') as DeityDomain | null;

  const deitiesAsync = useAsync(() => faithService.getDeities(), []);
  const templesAsync = useAsync(() => faithService.getTemples(), []);

  const filteredDeities = useMemo(() => {
    if (deitiesAsync.status !== 'success') return [];
    if (!needFilter) return deitiesAsync.data;
    return deitiesAsync.data.filter((d) => d.domain.includes(needFilter));
  }, [deitiesAsync, needFilter]);

  return (
    <PageScreen>
      <PageHeading title="探索" />

      {needFilter && (
        <p className="-mt-6 mb-8 text-xs text-ash-700">
          依「{needFilter}」篩選 ·{' '}
          <Link to="/explore" className="text-ash-500 transition-colors hover:text-ash-100">
            清除
          </Link>
        </p>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'deities', label: '神明' },
          { value: 'temples', label: '寺廟' },
        ]}
      />

      {tab === 'deities' && (
        <div>
          {deitiesAsync.status === 'loading' && <LoadingState label="載入中" />}
          {deitiesAsync.status === 'error' && (
            <ErrorState message="神明資料載入失敗" onRetry={deitiesAsync.retry} />
          )}
          {deitiesAsync.status === 'success' && filteredDeities.length === 0 && (
            <EmptyState title="沒有符合的神明" description="試著清除篩選條件，或探索其他需求分類。" />
          )}
          {deitiesAsync.status === 'success' &&
            filteredDeities.map((deity) => (
              <Link
                key={deity.id}
                to={`/explore/deities/${deity.id}`}
                className="group flex items-baseline justify-between gap-6 border-b border-void-line py-6"
              >
                <span>
                  <span className="font-display text-lg text-ash-300 transition-colors duration-200 group-hover:text-flame-core">
                    {deity.name}
                  </span>
                  <span className="ml-4 text-xs text-ash-700">{deity.title}</span>
                  <span className="mt-2 block text-xs text-ash-700">{deity.domain.join('・')}</span>
                </span>
                <SourceBadge source={deity.contentSource} />
              </Link>
            ))}
        </div>
      )}

      {tab === 'temples' && (
        <div>
          {templesAsync.status === 'loading' && <LoadingState label="載入中" />}
          {templesAsync.status === 'error' && (
            <ErrorState message="寺廟資料載入失敗" onRetry={templesAsync.retry} />
          )}
          {templesAsync.status === 'success' &&
            templesAsync.data.map((temple) => (
              <Link
                key={temple.id}
                to={`/explore/temples/${temple.id}`}
                className="group flex items-baseline justify-between gap-6 border-b border-void-line py-6"
              >
                <span>
                  <span className="font-display text-lg text-ash-300 transition-colors duration-200 group-hover:text-flame-core">
                    {temple.name}
                  </span>
                  <span className="mt-2 block text-xs text-ash-700">{temple.city}</span>
                </span>
                <SourceBadge source={temple.contentSource} />
              </Link>
            ))}
        </div>
      )}
    </PageScreen>
  );
}
