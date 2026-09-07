import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAsync } from '@/lib/useAsync';
import { faithService } from '@/services';
import { LoadingState, ErrorState } from '@/components/StateViews';
import { SourceBadge } from '@/components/SourceBadge';
import { Disclaimer } from '@/components/Disclaimer';
import { PageScreen } from '@/components/screens';

const ACTIONS = [
  { to: (id: string) => `/worship/${id}`, label: '線上拜拜', note: '上香、祈願' },
  { to: (id: string) => `/fortune/${id}`, label: '抽籤', note: '求籤、解讀' },
  { to: (id: string) => `/lantern/new/${id}`, label: '點燈', note: '為心願點一盞燈' },
];

export function DeitySpacePage() {
  const { deityId = '' } = useParams();
  const deityAsync = useAsync(() => faithService.getDeityById(deityId), [deityId]);

  if (deityAsync.status === 'loading') {
    return (
      <PageScreen>
        <LoadingState label="進入神明空間" />
      </PageScreen>
    );
  }
  if (deityAsync.status === 'error') {
    return (
      <PageScreen>
        <ErrorState message="無法載入神明資料" onRetry={deityAsync.retry} />
      </PageScreen>
    );
  }
  if (!deityAsync.data) {
    return (
      <PageScreen>
        <ErrorState message="找不到這位神明" />
      </PageScreen>
    );
  }
  const deity = deityAsync.data;

  return (
    // 仍是靠左的瀏覽構圖，但光源被拉近、調亮一點——
    // 這裡已經站在殿前，只是還沒進入儀式。
    <PageScreen light={{ source: 'ember', x: 14, y: 22, radius: 52, intensity: 0.16 }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.7 }}>
        <p className="text-[11px] tracking-ritual text-ash-700">{deity.title}</p>
        <h1 className="mt-6 font-display text-3xl font-medium tracking-wide text-ash-100">
          {deity.name}
        </h1>
        <p className="mt-6 max-w-md text-sm leading-loose text-ash-500">{deity.description}</p>
        <p className="mt-4 text-xs tracking-wide text-ash-700">掌管　{deity.domain.join('　')}</p>
        <div className="mt-4">
          <SourceBadge source={deity.contentSource} />
        </div>
      </motion.div>

      <nav className="mt-16">
        {ACTIONS.map((action) => (
          <Link
            key={action.label}
            to={action.to(deity.id)}
            className="group flex items-baseline gap-5 border-b border-void-line py-6"
          >
            <span className="font-display text-lg text-ash-300 transition-colors duration-200 group-hover:text-flame-core">
              {action.label}
            </span>
            <span className="text-xs text-ash-700">{action.note}</span>
          </Link>
        ))}
      </nav>

      <Disclaimer className="mt-14">
        本頁神明介紹為原型示意內容，非官方宗教文本；正式內容需由合作寺廟或宗教專業人士確認後，才會標示為「寺廟驗證內容」。
      </Disclaimer>
    </PageScreen>
  );
}
