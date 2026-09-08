import { Link } from 'react-router-dom';
import { useAsync } from '@/lib/useAsync';
import { faithService, MOCK_USER_ID } from '@/services';
import { LoadingState, ErrorState, EmptyState } from '@/components/StateViews';
import { PageScreen, PageHeading } from '@/components/screens';

export function LanternListPage() {
  const lampsAsync = useAsync(() => faithService.getLamps(MOCK_USER_ID), []);

  return (
    <PageScreen>
      <PageHeading title="點燈" description="您點過的燈，以及它們守護的心願。" />

      <Link
        to="/lantern/new"
        className="inline-block border border-flame/40 px-6 py-3 text-[13px] tracking-wide text-flame-core transition-colors hover:border-flame/70"
      >
        為心願點一盞燈
      </Link>

      <div className="mt-12">
        {lampsAsync.status === 'loading' && <LoadingState label="載入中" />}
        {lampsAsync.status === 'error' && <ErrorState message="無法載入點燈紀錄" onRetry={lampsAsync.retry} />}
        {lampsAsync.status === 'success' && lampsAsync.data.length === 0 && (
          <EmptyState title="尚未點過燈" description="為自己或家人點一盞燈，象徵長期的祈願陪伴。" />
        )}
        {lampsAsync.status === 'success' &&
          lampsAsync.data.map((lamp) => (
            <div key={lamp.id} className="border-b border-void-line py-6">
              <div className="flex items-baseline gap-4">
                {/* 每盞燈前面的那一點，就是那盞燈本身 */}
                <span
                  className="animate-breathe h-1 w-1 shrink-0 rounded-full bg-flame"
                  style={{ boxShadow: '0 0 10px 3px rgba(var(--light-flame), 0.4)' }}
                  aria-hidden
                />
                <span className="font-display text-base text-ash-300">{lamp.type}</span>
              </div>
              <p className="mt-3 pl-5 text-sm leading-relaxed text-ash-500">「{lamp.wish}」</p>
              <p className="mt-3 pl-5 text-[11px] text-ash-700">
                {new Date(lamp.litAt).toLocaleDateString('zh-TW')} —{' '}
                {new Date(lamp.expiresAt).toLocaleDateString('zh-TW')}
              </p>
            </div>
          ))}
      </div>
    </PageScreen>
  );
}
