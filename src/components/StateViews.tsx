import type { ReactNode } from 'react';
import { Button } from './Button';

export function LoadingState({ label = '載入中…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-ink-500">
      <div
        className="h-6 w-6 animate-spin rounded-full border-2 border-ink-200 border-t-ink-600"
        role="status"
        aria-label={label}
      />
      <p className="text-sm">{label}</p>
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
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-ink-200 py-16 text-center">
      <p className="text-base font-medium text-ink-800">{title}</p>
      {description && <p className="max-w-xs text-sm text-ink-500">{description}</p>}
      {action}
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
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-ember-200 bg-ember-50 py-12 text-center">
      <p className="text-sm text-ember-700">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="md" onClick={onRetry}>
          重試
        </Button>
      )}
    </div>
  );
}
