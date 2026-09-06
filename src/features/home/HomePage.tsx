import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { riseIn } from '@/lib/motionTokens';
import type { DeityDomain } from '@/domain/types';

const NEEDS: { domain: DeityDomain; description: string }[] = [
  { domain: '學業事業', description: '考試、面試、工作決策' },
  { domain: '姻緣感情', description: '感情、婚姻、人際關係' },
  { domain: '平安健康', description: '身體、家人、出行平安' },
  { domain: '財運', description: '財務、投資、事業機會' },
  { domain: '陰陽調和', description: '心境安定、情緒調適' },
  { domain: '合境平安', description: '居家、社區、整體平安' },
];

export function HomePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:py-16">
      <motion.div {...riseIn}>
        <p className="text-sm text-ink-500">信仰時光 · 原型 · 全部內容為 Mock Data</p>
        <h1 className="mt-2 font-display text-2xl font-medium text-ink-900 md:text-3xl">
          此刻，想從哪個心願開始？
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-relaxed text-ink-600">
          選擇最貼近此刻心境的需求，我們會為您找到合適的神明空間，開始線上拜拜、祈願或求籤。
        </p>
      </motion.div>

      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3">
        {NEEDS.map((need, index) => (
          <motion.div
            key={need.domain}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
          >
            <Link
              to={`/explore?need=${encodeURIComponent(need.domain)}`}
              className="flex h-full flex-col justify-between rounded-lg border border-ink-100 bg-surface-raised p-4 shadow-soft transition-shadow hover:shadow-raised"
            >
              <p className="font-display text-base font-medium text-ink-900">{need.domain}</p>
              <p className="mt-2 text-xs text-ink-500">{need.description}</p>
            </Link>
          </motion.div>
        ))}
      </div>

      <div className="mt-10 flex flex-col gap-2 border-t border-ink-100 pt-6 text-sm">
        <Link to="/explore" className="text-ink-700 underline underline-offset-4 hover:text-ink-900">
          直接探索所有神明與寺廟 →
        </Link>
        <Link to="/my" className="text-ink-700 underline underline-offset-4 hover:text-ink-900">
          查看我的信仰紀錄 →
        </Link>
      </div>
    </div>
  );
}
