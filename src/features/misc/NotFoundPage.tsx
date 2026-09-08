import { Link } from 'react-router-dom';
import { PageScreen } from '@/components/screens';

export function NotFoundPage() {
  return (
    <PageScreen>
      <h1 className="font-display text-xl tracking-wide text-ash-300">找不到這個頁面</h1>
      <p className="mt-5 max-w-sm text-sm leading-relaxed text-ash-500">
        您要前往的內容不存在，或已經被移除。
      </p>
      <Link
        to="/"
        className="mt-10 inline-block text-[13px] text-ash-300 transition-colors hover:text-flame-core"
      >
        回到首頁
      </Link>
    </PageScreen>
  );
}
