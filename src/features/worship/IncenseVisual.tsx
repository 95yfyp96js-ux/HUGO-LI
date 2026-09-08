import { motion } from 'framer-motion';

/**
 * 香。
 *
 * 這是整個畫面唯一「實體的光」：一點餘燼，加上被它照亮的一小段香身。
 * 煙只用兩道極低透明度的細柱，因為在夜裡、只有一點火光的情況下，
 * 人眼本來就只看得到煙的一小段，看不到整片煙霧。
 * 沒有粒子、沒有 glow filter——亮度差本身就是質感。
 */
export function IncenseVisual({ lit }: { lit: boolean }) {
  return (
    <div className="relative flex h-44 w-24 items-end justify-center">
      {lit &&
        [0, 1].map((i) => (
          <motion.div
            key={i}
            className="absolute bottom-[7.5rem] w-px"
            style={{
              left: `calc(50% + ${i === 0 ? -3 : 3}px)`,
              height: '5rem',
              background:
                'linear-gradient(to top, rgba(230,224,214,0.16), rgba(230,224,214,0.04) 45%, transparent)',
            }}
            initial={{ opacity: 0, y: 0 }}
            animate={{ opacity: [0, 1, 0], y: -44, x: i === 0 ? -6 : 5 }}
            transition={{ duration: 4.2, repeat: Infinity, delay: i * 1.6, ease: 'easeOut' }}
          />
        ))}

      {/* 香身：只有靠近火點的一段被照亮，往下沒入黑暗 */}
      <div
        className="relative h-28 w-px"
        style={{
          background: lit
            ? 'linear-gradient(to bottom, rgba(227,178,107,0.85), rgba(120,96,70,0.35) 35%, rgba(80,70,60,0.12))'
            : 'linear-gradient(to bottom, rgba(140,128,112,0.4), rgba(80,72,64,0.12))',
        }}
      >
        {lit && (
          <motion.div
            className="absolute -top-px left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-ember-core"
            animate={{ opacity: [0.75, 1, 0.8], scale: [1, 1.12, 1] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
            style={{ boxShadow: '0 0 16px 5px rgba(var(--light-ember), 0.55)' }}
          />
        )}
      </div>

      {/* 香爐口：只是一條被火光勾出的邊，不畫完整的爐 */}
      <div
        className="absolute bottom-0 h-px w-14"
        style={{
          background: lit
            ? 'linear-gradient(to right, transparent, rgba(227,178,107,0.5), transparent)'
            : 'linear-gradient(to right, transparent, rgba(140,128,112,0.22), transparent)',
        }}
        aria-hidden
      />
    </div>
  );
}
