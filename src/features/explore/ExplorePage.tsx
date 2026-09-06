import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Tabs } from '@/components/Tabs';
import { Card } from '@/components/Card';
import { SourceBadge } from '@/components/SourceBadge';
import { LoadingState, ErrorState, EmptyState } from '@/components/StateViews';
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
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-display text-xl font-medium text-ink-900">探索</h1>
      {needFilter && (
        <p className="mt-1 text-sm text-ink-500">
          依「{needFilter}」篩選神明 ·{' '}
          <Link to="/explore" className="underline underline-offset-2">
            清除篩選
          </Link>
        </p>
      )}

      <div className="mt-4">
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'deities', label: '神明探索' },
            { value: 'temples', label: '寺廟探索' },
          ]}
        />
      </div>

      {tab === 'deities' && (
        <div className="mt-6">
          {deitiesAsync.status === 'loading' && <LoadingState label="載入神明資料中…" />}
          {deitiesAsync.status === 'error' && (
            <ErrorState message="神明資料載入失敗" onRetry={deitiesAsync.retry} />
          )}
          {deitiesAsync.status === 'success' && filteredDeities.length === 0 && (
            <EmptyState title="找不到符合的神明" description="試試清除篩選條件，或探索其他需求分類。" />
          )}
          {deitiesAsync.status === 'success' && filteredDeities.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filteredDeities.map((deity) => (
                <Link key={deity.id} to={`/explore/deities/${deity.id}`}>
                  <Card className="p-4 transition-shadow hover:shadow-raised">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-display text-base font-medium text-ink-900">
                          {deity.name}
                        </p>
                        <p className="text-xs text-ink-500">{deity.title}</p>
                      </div>
                      <SourceBadge source={deity.contentSource} />
                    </div>
                    <p className="mt-2 text-xs text-ink-500">
                      {deity.domain.join('・')}
                    </p>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'temples' && (
        <div className="mt-6">
          {templesAsync.status === 'loading' && <LoadingState label="載入寺廟資料中…" />}
          {templesAsync.status === 'error' && (
            <ErrorState message="寺廟資料載入失敗" onRetry={templesAsync.retry} />
          )}
          {templesAsync.status === 'success' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {templesAsync.data.map((temple) => (
                <Link key={temple.id} to={`/explore/temples/${temple.id}`}>
                  <Card className="p-4 transition-shadow hover:shadow-raised">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-display text-base font-medium text-ink-900">
                          {temple.name}
                        </p>
                        <p className="text-xs text-ink-500">{temple.city}</p>
                      </div>
                      <SourceBadge source={temple.contentSource} />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
