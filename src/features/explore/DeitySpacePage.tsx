import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAsync } from '@/lib/useAsync';
import { faithService } from '@/services';
import { LoadingState, ErrorState } from '@/components/StateViews';
import { SourceBadge } from '@/components/SourceBadge';
import { Disclaimer } from '@/components/Disclaimer';
import { ceremonyReveal } from '@/lib/motionTokens';

export function DeitySpacePage() {
  const { deityId = '' } = useParams();
  const deityAsync = useAsync(() => faithService.getDeityById(deityId), [deityId]);

  if (deityAsync.status === 'loading') return <LoadingState label="進入神明空間中…" />;
  if (deityAsync.status === 'error') {
    return <ErrorState message="無法載入神明資料" onRetry={deityAsync.retry} />;
  }
  const deity = deityAsync.data;
  if (!deity) {
    return <ErrorState message="找不到這位神明" />;
  }

  return (
    <motion.div {...ceremonyReveal} className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-ink-500">{deity.title}</p>
          <h1 className="mt-1 font-display text-2xl font-medium text-ink-900">{deity.name}</h1>
        </div>
        <SourceBadge source={deity.contentSource} />
      </div>

      <p className="mt-4 max-w-lg text-sm leading-relaxed text-ink-600">{deity.description}</p>
      <p className="mt-2 text-xs text-ink-400">掌管：{deity.domain.join('・')}</p>

      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link
          to={`/worship/${deity.id}`}
          className="rounded-lg border border-ink-200 bg-surface-raised p-5 text-center shadow-soft transition-shadow hover:shadow-raised"
        >
          <p className="font-display text-base font-medium text-ink-900">線上拜拜</p>
          <p className="mt-1 text-xs text-ink-500">上香、祈願</p>
        </Link>
        <Link
          to={`/fortune/${deity.id}`}
          className="rounded-lg border border-ink-200 bg-surface-raised p-5 text-center shadow-soft transition-shadow hover:shadow-raised"
        >
          <p className="font-display text-base font-medium text-ink-900">抽籤</p>
          <p className="mt-1 text-xs text-ink-500">求籤、解讀</p>
        </Link>
        <Link
          to={`/lantern/new/${deity.id}`}
          className="rounded-lg border border-ink-200 bg-surface-raised p-5 text-center shadow-soft transition-shadow hover:shadow-raised"
        >
          <p className="font-display text-base font-medium text-ink-900">點燈</p>
          <p className="mt-1 text-xs text-ink-500">為心願點一盞燈</p>
        </Link>
      </div>

      <Disclaimer className="mt-8">
        本頁神明介紹為原型示意內容，非官方宗教文本；正式內容需由合作寺廟或宗教專業人士確認後才會標示為「寺廟驗證內容」。
      </Disclaimer>
    </motion.div>
  );
}
