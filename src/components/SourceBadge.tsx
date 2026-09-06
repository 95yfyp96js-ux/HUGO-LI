import type { ContentSource } from '@/domain/types';
import clsx from '@/lib/clsx';

/**
 * Phase 10 宗教內容安全機制：每一段宗教相關內容都必須清楚標示來源，
 * 不得讓 AI 生成內容或原型示意資料被誤認為官方宗教內容。
 */
const LABELS: Record<ContentSource, string> = {
  MOCK_DATA: '原型示意內容',
  AI_GENERATED: 'AI 輔助生成',
  TEMPLE_VERIFIED: '寺廟驗證內容',
};

const CLASSES: Record<ContentSource, string> = {
  MOCK_DATA: 'bg-ink-100 text-ink-600',
  AI_GENERATED: 'bg-gold-400/20 text-gold-600',
  TEMPLE_VERIFIED: 'bg-jade-100 text-jade-700',
};

export function SourceBadge({ source }: { source: ContentSource }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium',
        CLASSES[source],
      )}
    >
      {LABELS[source]}
    </span>
  );
}
