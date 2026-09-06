import { motion } from 'framer-motion';
import type { FortuneState } from './machine';

/**
 * 籤筒視覺：搖動（SHAKING）→ 單支籤飛出（DRAWING）。
 * 節制的動效：只有搖動幅度與單一飛出軌跡，不做粒子或多籤同時飛出的花俏效果。
 */
export function FortuneVisual({ state }: { state: FortuneState }) {
  const shaking = state === 'SHAKING';
  const drawing = state === 'DRAWING' || state === 'REVEALING';

  return (
    <div className="relative flex h-48 w-32 items-end justify-center">
      <motion.div
        className="relative flex h-32 w-20 items-end justify-center gap-1 rounded-b-xl rounded-t-md border-2 border-ember-300/70 bg-ember-900/20 pb-2"
        animate={shaking ? { rotate: [0, -4, 4, -3, 3, 0] } : { rotate: 0 }}
        transition={shaking ? { duration: 0.5, repeat: Infinity } : { duration: 0.3 }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <motion.div
            key={i}
            className="h-20 w-1 rounded-full bg-ember-200/70"
            style={{ marginBottom: i === 2 ? 6 : 0 }}
            animate={
              drawing && i === 2
                ? { y: -70, opacity: [1, 1, 0] }
                : { y: 0, opacity: 1 }
            }
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          />
        ))}
      </motion.div>
    </div>
  );
}
