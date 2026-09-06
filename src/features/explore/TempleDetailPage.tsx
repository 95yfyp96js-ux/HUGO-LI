import { Link, useParams } from 'react-router-dom';
import { useAsync } from '@/lib/useAsync';
import { faithService } from '@/services';
import { LoadingState, ErrorState } from '@/components/StateViews';
import { SourceBadge } from '@/components/SourceBadge';
import { Disclaimer } from '@/components/Disclaimer';

export function TempleDetailPage() {
  const { templeId = '' } = useParams();
  const templeAsync = useAsync(() => faithService.getTempleById(templeId), [templeId]);
  const deitiesAsync = useAsync(() => faithService.getDeities(), []);

  if (templeAsync.status === 'loading') return <LoadingState label="載入寺廟資料中…" />;
  if (templeAsync.status === 'error') {
    return <ErrorState message="無法載入寺廟資料" onRetry={templeAsync.retry} />;
  }
  const temple = templeAsync.data;
  if (!temple) return <ErrorState message="找不到這間寺廟" />;

  const deities =
    deitiesAsync.status === 'success'
      ? deitiesAsync.data.filter((d) => temple.deityIds.includes(d.id))
      : [];

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink-900">{temple.name}</h1>
          <p className="mt-1 text-sm text-ink-500">
            {temple.city} · {temple.address}
          </p>
        </div>
        <SourceBadge source={temple.contentSource} />
      </div>

      <p className="mt-4 text-sm leading-relaxed text-ink-600">{temple.description}</p>

      {deities.length > 0 && (
        <div className="mt-8">
          <p className="text-sm font-medium text-ink-700">供奉神明</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {deities.map((deity) => (
              <Link
                key={deity.id}
                to={`/explore/deities/${deity.id}`}
                className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:border-ink-400"
              >
                {deity.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      <Disclaimer className="mt-8">
        本頁寺廟資訊為原型示意內容，非真實寺廟授權資料，僅供展示信仰探索體驗使用。
      </Disclaimer>
    </div>
  );
}
