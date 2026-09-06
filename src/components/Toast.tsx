import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { duration, ease } from '@/lib/motionTokens';

interface ToastItem {
  id: number;
  message: string;
  tone: 'default' | 'success' | 'error';
}

interface ToastContextValue {
  show: (message: string, tone?: ToastItem['tone']) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, tone: ToastItem['tone'] = 'default') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 2600);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 md:bottom-8">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: duration.standard, ease: ease.settle }}
              className={
                'pointer-events-auto rounded-md px-4 py-2 text-sm shadow-raised ' +
                (toast.tone === 'error'
                  ? 'bg-ember-600 text-surface'
                  : toast.tone === 'success'
                    ? 'bg-jade-700 text-surface'
                    : 'bg-ink-900 text-surface')
              }
            >
              {toast.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
