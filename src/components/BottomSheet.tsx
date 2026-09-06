import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { duration, ease } from '@/lib/motionTokens';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/** 手機用 Modal 呈現方式；桌面亦可重用（置中卡片）。 */
export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-ink-950/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.standard }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-xl bg-surface-raised p-6 shadow-raised md:inset-x-auto md:left-1/2 md:bottom-auto md:top-1/2 md:w-full md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: duration.ceremony, ease: ease.settle }}
          >
            {title && <h2 className="mb-4 text-lg font-display font-medium text-ink-900">{title}</h2>}
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
