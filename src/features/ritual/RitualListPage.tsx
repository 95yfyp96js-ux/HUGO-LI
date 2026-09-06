import { Link } from 'react-router-dom';
import { useAsync } from '@/lib/useAsync';
import { faithService } from '@/services';
import { LoadingState, ErrorState, EmptyState } from '@/components/StateViews';
import { Card } from '@/components/Card';
import { Disclaimer } from '@/components/Disclaimer';

export function RitualListPage() {
  const ritualsAsync = useAsync(() => faithService.getRituals(), []);
  const templesAsync = useAsync(() => faithService.getTemples(), []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="font-display text-xl font-medium text-ink-900">祭改／傳統儀式</h1>
      <Disclaimer className="mt-2">
        本頁僅提供儀式說明與預約入口，實際儀式須由寺廟人員親自執行；本平台不執行、不模擬儀式，亦不保證任何效果。
      </Disclaimer>

      <div className="mt-6">
        {ritualsAsync.status === 'loading' && <LoadingState label="載入儀式資訊中…" />}
        {ritualsAsync.status === 'error' && <ErrorState message="無法載入儀式資訊" onRetry={ritualsAsync.retry} />}
        {ritualsAsync.status === 'success' && ritualsAsync.data.length === 0 && (
          <EmptyState title="目前沒有可預約的儀式" />
        )}
        {ritualsAsync.status === 'success' && ritualsAsync.data.length > 0 && (
          <div className="flex flex-col gap-3">
            {ritualsAsync.data.map((ritual) => {
              const temple =
                templesAsync.status === 'success'
                  ? templesAsync.data.find((t) => t.id === ritual.templeId)
                  : undefined;
              return (
                <Link key={ritual.id} to={`/ritual/${ritual.id}`}>
                  <Card className="p-4 transition-shadow hover:shadow-raised">
                    <p className="font-medium text-ink-900">{ritual.name}</p>
                    {temple && <p className="mt-1 text-xs text-ink-500">{temple.name}</p>}
                    <p className="mt-2 text-xs text-ink-500">{ritual.applicabilityNotes}</p>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
