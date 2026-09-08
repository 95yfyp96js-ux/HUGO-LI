import type { ReactNode } from 'react';
import clsx from '@/lib/clsx';

/**
 * 免責聲明。必須看得見、但不該搶走儀式的注意力——
 * 用一條靠左的細線帶出，而不是一個灰色方塊。
 */
export function Disclaimer({
  children,
  className,
  onPaper = false,
}: {
  children: ReactNode;
  className?: string;
  onPaper?: boolean;
}) {
  return (
    <p
      className={clsx(
        'border-l pl-4 text-left text-[11px] leading-relaxed',
        onPaper ? 'border-paper-shade text-paper-ink/65' : 'border-ash-900 text-ash-500',
        className,
      )}
    >
      {children}
    </p>
  );
}
