import { Link } from 'react-router-dom';
import { useAsync } from '@/lib/useAsync';
import { faithService, MOCK_USER_ID } from '@/services';
import { LoadingState, ErrorState, EmptyState } from '@/components/StateViews';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';

export function LanternListPage() {
  const lampsAsync = useAsync(() => faithService.getLamps(MOCK_USER_ID), []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-medium text-ink-900">點燈</h1>
        <Link to="/lantern/new">
          <Button size="md">為心願點一盞燈</Button>
        </Link>
      </div>

      <div className="mt-6">
        {lampsAsync.status === 'loading' && <LoadingState label="載入點燈紀錄中…" />}
        {lampsAsync.status === 'error' && <ErrorState message="無法載入點燈紀錄" onRetry={lampsAsync.retry} />}
        {lampsAsync.status === 'success' && lampsAsync.data.length === 0 && (
          <EmptyState
            title="尚未點過燈"
            description="為自己或家人點一盞燈，象徵長期的祈願陪伴。"
            action={
              <Link to="/lantern/new">
                <Button size="md">開始點燈</Button>
              </Link>
            }
          />
        )}
        {lampsAsync.status === 'success' && lampsAsync.data.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {lampsAsync.data.map((lamp) => (
              <Card key={lamp.id} className="p-4">
                <p className="font-display text-base font-medium text-ink-900">{lamp.type}</p>
                <p className="mt-1 text-xs text-ink-500">「{lamp.wish}」</p>
                <p className="mt-3 text-xs text-ink-400">
                  點燈於 {new Date(lamp.litAt).toLocaleDateString('zh-TW')} · 至{' '}
                  {new Date(lamp.expiresAt).toLocaleDateString('zh-TW')}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
