import { motion } from 'framer-motion';

/**
 * 香柱視覺。刻意保持簡約線條與低對比煙霧，避免 Phase 5 禁止的 Glow/Particle 濫用——
 * 煙霧只用 2-3 道低透明度的漸層柱體做垂直飄移，而非粒子系統。
 */
export function IncenseVisual({ lit }: { lit: boolean }) {
  return (
    <div className="relative flex h-40 w-24 items-end justify-center">
      {lit &&
        [0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="absolute bottom-24 h-24 w-1.5 rounded-full bg-gradient-to-t from-ink-200/25 to-transparent"
            style={{ left: `${44 + i * 4}%` }}
            initial={{ opacity: 0, y: 0, scaleX: 1 }}
            animate={{ opacity: [0, 0.5, 0], y: -60, scaleX: [1, 2.2] }}
            transition={{
              duration: 2.6,
              repeat: Infinity,
              delay: i * 0.7,
              ease: 'easeOut',
            }}
          />
        ))}

      <div className="relative z-10 h-24 w-1 rounded-full bg-ember-200/80">
        {lit && (
          <motion.div
            className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-ember-400"
            animate={{ opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
      </div>

      <div className="absolute bottom-0 h-3 w-16 rounded-full bg-ink-200/20" aria-hidden />
    </div>
  );
}
