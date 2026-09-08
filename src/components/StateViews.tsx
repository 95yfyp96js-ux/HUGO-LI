import type { ReactNode } from 'react';
import { Button } from './Button';

/**
 * Loading／Empty／Error 在夜裡的樣子。
 * 沒有 spinner 圓圈——轉圈的 loading 是白天 App 的語彙，而且會變成一個動來動去的亮點。
 * 這裡用一顆呼吸的餘燼：它就是這個畫面暫時的光。
 */
export function LoadingState({ label = '載入中' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-5 py-20 text-center">
      <div
        className="animate-breathe h-1.5 w-1.5 rounded-full bg-ember"
        role="status"
        aria-label={label}
        style={{ boxShadow: '0 0 12px 3px rgba(var(--light-ember), 0.5)' }}
      />
      <p className="text-xs tracking-wide text-ash-500">{label}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="py-16">
      <p className="font-display text-base text-ash-300">{title}</p>
      {description && <p className="mt-3 max-w-sm text-sm leading-relaxed text-ash-500">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message = '發生錯誤，請稍後再試。',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="border-l border-ember-deep py-6 pl-5">
      <p className="text-sm text-ash-300">{message}</p>
      {onRetry && (
        <Button variant="quiet" size="md" className="mt-4" onClick={onRetry}>
          重試
        </Button>
      )}
    </div>
  );
}
