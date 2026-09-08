import { Link, useParams } from 'react-router-dom';
import { useAsync } from '@/lib/useAsync';
import { faithService } from '@/services';
import { LoadingState, ErrorState } from '@/components/StateViews';
import { SourceBadge } from '@/components/SourceBadge';
import { Disclaimer } from '@/components/Disclaimer';
import { PageScreen } from '@/components/screens';

export function TempleDetailPage() {
  const { templeId = '' } = useParams();
  const templeAsync = useAsync(() => faithService.getTempleById(templeId), [templeId]);
  const deitiesAsync = useAsync(() => faithService.getDeities(), []);

  if (templeAsync.status === 'loading') {
    return (
      <PageScreen>
        <LoadingState label="載入中" />
      </PageScreen>
    );
  }
  if (templeAsync.status === 'error') {
    return (
      <PageScreen>
        <ErrorState message="無法載入寺廟資料" onRetry={templeAsync.retry} />
      </PageScreen>
    );
  }
  if (!templeAsync.data) {
    return (
      <PageScreen>
        <ErrorState message="找不到這間寺廟" />
      </PageScreen>
    );
  }
  const temple = templeAsync.data;

  const deities =
    deitiesAsync.status === 'success'
      ? deitiesAsync.data.filter((d) => temple.deityIds.includes(d.id))
      : [];

  return (
    <PageScreen>
      <p className="text-[11px] tracking-ritual text-ash-700">{temple.city}</p>
      <h1 className="mt-6 font-display text-2xl font-medium tracking-wide text-ash-100">
        {temple.name}
      </h1>
      <p className="mt-3 text-xs text-ash-700">{temple.address}</p>
      <p className="mt-8 max-w-md text-sm leading-loose text-ash-500">{temple.description}</p>
      <div className="mt-4">
        <SourceBadge source={temple.contentSource} />
      </div>

      {deities.length > 0 && (
        <section className="mt-16">
          <p className="text-[11px] tracking-ritual text-ash-700">供奉神明</p>
          <div className="mt-4">
            {deities.map((deity) => (
              <Link
                key={deity.id}
                to={`/explore/deities/${deity.id}`}
                className="block border-b border-void-line py-5 font-display text-lg text-ash-300 transition-colors duration-200 hover:text-flame-core"
              >
                {deity.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      <Disclaimer className="mt-14">
        本頁寺廟資訊為原型示意內容，非真實寺廟授權資料，僅供展示信仰探索體驗使用。
      </Disclaimer>
    </PageScreen>
  );
}
