import type { ContentSource } from '@/domain/types';
import clsx from '@/lib/clsx';

/**
 * Phase 10 宗教內容安全機制：每一段宗教相關內容都必須清楚標示來源。
 *
 * 視覺上刻意做得非常小、非常安靜——它是責任標示，不是徽章或裝飾。
 * 只用字距與極淡的字色，沒有底色色塊（底色會變成畫面上多餘的亮點）。
 */
const LABELS: Record<ContentSource, string> = {
  MOCK_DATA: '原型示意內容',
  AI_GENERATED: 'AI 輔助生成',
  TEMPLE_VERIFIED: '寺廟驗證內容',
};

export function SourceBadge({
  source,
  onPaper = false,
}: {
  source: ContentSource;
  /** 標示在紙上時要用墨色，不能用夜色的字 */
  onPaper?: boolean;
}) {
  return (
    <span
      className={clsx(
        'inline-block text-[10px] tracking-wide',
        onPaper ? 'text-paper-ink/55' : 'text-ash-700',
      )}
    >
      {LABELS[source]}
    </span>
  );
}
