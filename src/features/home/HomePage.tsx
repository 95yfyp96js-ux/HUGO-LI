import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { PageScreen } from '@/components/screens';
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
    <PageScreen>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        <p className="text-[11px] tracking-ritual text-ash-700">原型 · 全部內容為 MOCK DATA</p>
        <h1 className="mt-8 font-display text-[26px] font-medium leading-relaxed tracking-wide text-ash-100 md:text-3xl">
          此刻，
          <br />
          想從哪個心願開始？
        </h1>
      </motion.div>

      {/* 需求清單：沒有卡片、沒有格線，只有字級對比與留白 */}
      <ul className="mt-16">
        {NEEDS.map((need, index) => (
          <motion.li
            key={need.domain}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.15 + index * 0.06 }}
          >
            <Link
              to={`/explore?need=${encodeURIComponent(need.domain)}`}
              className="group flex items-baseline gap-5 border-b border-void-line py-5 transition-colors duration-200"
            >
              <span className="font-display text-lg text-ash-300 transition-colors duration-200 group-hover:text-flame-core">
                {need.domain}
              </span>
              <span className="text-xs text-ash-700 transition-colors duration-200 group-hover:text-ash-500">
                {need.description}
              </span>
            </Link>
          </motion.li>
        ))}
      </ul>

      <div className="mt-14 flex flex-col gap-4 text-[13px]">
        <Link to="/explore" className="text-ash-500 transition-colors hover:text-ash-100">
          直接探索所有神明與寺廟
        </Link>
        <Link to="/my" className="text-ash-500 transition-colors hover:text-ash-100">
          查看我的信仰紀錄
        </Link>
      </div>
    </PageScreen>
  );
}
