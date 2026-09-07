import { Link } from 'react-router-dom';
import { useAsync } from '@/lib/useAsync';
import { faithService } from '@/services';
import { LoadingState, ErrorState, EmptyState } from '@/components/StateViews';
import { Disclaimer } from '@/components/Disclaimer';
import { PageScreen, PageHeading } from '@/components/screens';

/**
 * 祭改是敏感功能，所以它在視覺上刻意「不像儀式」：
 * 靠左、無光源強調、沒有任何戲劇性——因為真正的儀式在廟裡發生，不在這個畫面裡。
 * 這個克制本身就是產品立場的一部分（見 RED_TEAM_REPORT.md）。
 */
export function RitualListPage() {
  const ritualsAsync = useAsync(() => faithService.getRituals(), []);
  const templesAsync = useAsync(() => faithService.getTemples(), []);

  return (
    <PageScreen light={{ source: 'flame', x: 4, y: -10, radius: 40, intensity: 0.07 }}>
      <PageHeading title="祭改／傳統儀式" />

      <Disclaimer>
        本頁僅提供儀式說明與預約入口。實際儀式須由寺廟人員親自執行；本平台不執行、不模擬儀式，亦不保證任何效果。
      </Disclaimer>

      <div className="mt-12">
        {ritualsAsync.status === 'loading' && <LoadingState label="載入中" />}
        {ritualsAsync.status === 'error' && <ErrorState message="無法載入儀式資訊" onRetry={ritualsAsync.retry} />}
        {ritualsAsync.status === 'success' && ritualsAsync.data.length === 0 && (
          <EmptyState title="目前沒有可預約的儀式" />
        )}
        {ritualsAsync.status === 'success' &&
          ritualsAsync.data.map((ritual) => {
            const temple =
              templesAsync.status === 'success'
                ? templesAsync.data.find((t) => t.id === ritual.templeId)
                : undefined;
            return (
              <Link
                key={ritual.id}
                to={`/ritual/${ritual.id}`}
                className="group block border-b border-void-line py-6"
              >
                <span className="font-display text-base text-ash-300 transition-colors group-hover:text-ash-100">
                  {ritual.name}
                </span>
                {temple && <span className="mt-2 block text-[11px] text-ash-700">{temple.name}</span>}
                <span className="mt-3 block max-w-md text-xs leading-relaxed text-ash-700">
                  {ritual.applicabilityNotes}
                </span>
              </Link>
            );
          })}
      </div>
    </PageScreen>
  );
}
