import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/StateViews';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <EmptyState
        title="找不到這個頁面"
        description="您要前往的內容不存在，或已經被移除。"
        action={
          <Link
            to="/"
            className="inline-flex h-11 items-center justify-center rounded-md bg-ink-900 px-5 text-sm font-medium text-surface hover:bg-ink-800"
          >
            回到首頁
          </Link>
        }
      />
    </div>
  );
}
