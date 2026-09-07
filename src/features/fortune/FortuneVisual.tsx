import { motion } from 'framer-motion';
import type { FortuneState } from './machine';

/**
 * 籤筒。
 *
 * 夜裡看不見整個籤筒，只看得見被燭光勾出的筒口輪廓，
 * 以及筒裡幾根被照到頂端的籤。搖動時整體晃動、光影跟著晃；
 * 抽出時只有一根籤升起——升到光裡，然後畫面交給籤紙本身。
 */
export function FortuneVisual({ state }: { state: FortuneState }) {
  const shaking = state === 'SHAKING';
  const drawing = state === 'DRAWING' || state === 'REVEALING';

  return (
    <div className="relative flex h-52 w-28 items-end justify-center">
      <motion.div
        className="relative flex h-36 w-16 items-end justify-center gap-[5px]"
        animate={shaking ? { rotate: [0, -3.5, 3.5, -2.5, 2.5, 0], y: [0, -2, 0, -2, 0] } : { rotate: 0, y: 0 }}
        transition={shaking ? { duration: 0.55, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.4 }}
      >
        {[0, 1, 2, 3, 4].map((i) => {
          const isDrawn = i === 2;
          return (
            <motion.div
              key={i}
              className="w-px"
              style={{
                height: `${7 + (i % 2) * 0.6}rem`,
                background:
                  'linear-gradient(to top, transparent, rgba(227,178,107,0.18) 35%, rgba(240,215,170,0.55))',
              }}
              animate={drawing && isDrawn ? { y: -76, opacity: [1, 1, 0] } : { y: 0, opacity: 1 }}
              transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
            />
          );
        })}

        {/* 筒口：一條被光勾出的橫線，不畫容器本體 */}
        <div
          className="absolute bottom-0 h-px w-full"
          style={{ background: 'linear-gradient(to right, transparent, rgba(227,178,107,0.45), transparent)' }}
          aria-hidden
        />
      </motion.div>
    </div>
  );
}
