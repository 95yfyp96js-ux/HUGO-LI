import type { HTMLAttributes } from 'react';
import clsx from '@/lib/clsx';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        'rounded-lg border border-ink-100 bg-surface-raised shadow-soft',
        className,
      )}
      {...props}
    />
  );
}
