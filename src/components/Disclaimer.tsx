import type { ReactNode } from 'react';
import clsx from '@/lib/clsx';

export function Disclaimer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={clsx('rounded-md bg-ink-50 p-3 text-xs leading-relaxed text-ink-600', className)}>
      {children}
    </p>
  );
}
