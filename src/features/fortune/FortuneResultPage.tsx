import { Link, useParams } from 'react-router-dom';
import { useAsync } from '@/lib/useAsync';
import { faithService, MOCK_USER_ID } from '@/services';
import { LoadingState, ErrorState } from '@/components/StateViews';
import { SourceBadge } from '@/components/SourceBadge';
import { Disclaimer } from '@/components/Disclaimer';

/** 從 refId（格式 `${deityId}-stick-${n}`）反推 deityId，避免額外新增 service 方法。 */
function parseDeityIdFromStickId(stickId: string): string | null {
  const match = stickId.match(/^(.*)-stick-\d+$/);
  return match ? match[1] : null;
}

export function FortuneResultPage() {
  const { ceremonyId = '' } = useParams();

  const dataAsync = useAsync(async () => {
    const history = await faithService.getHistory(MOCK_USER_ID);
    const entry = history.find((h) => h.id === ceremonyId && h.type === 'FORTUNE');
    if (!entry) throw new Error('找不到這筆籤詩紀錄');
    const deityId = parseDeityIdFromStickId(entry.refId);
    if (!deityId) throw new Error('資料格式異常');
    const set = await faithService.getFortuneSet(deityId);
    const stick = set.sticks.find((s) => s.id === entry.refId);
    if (!stick) throw new Error('找不到對應的籤詩內容');
    const interpretation = await faithService.interpretFortune(stick);
    return { entry, stick, interpretation };
  }, [ceremonyId]);

  if (dataAsync.status === 'loading') return <LoadingState label="載入籤詩紀錄中…" />;
  if (dataAsync.status === 'error') {
    return <ErrorState message={dataAsync.error.message} onRetry={dataAsync.retry} />;
  }

  const { entry, stick, interpretation } = dataAsync.data;

  return (
    <div className="mx-auto max-w-md px-4 py-10 text-center">
      <p className="text-xs text-ink-400">{new Date(entry.timestamp).toLocaleString('zh-TW')}</p>
      <p className="mt-2 text-xs text-ink-400">第 {stick.number} 籤</p>
      <h1 className="mt-1 font-display text-2xl font-medium text-ink-900">{stick.level}</h1>
      <p className="mt-4 text-sm leading-loose text-ink-700">{stick.poem}</p>

      <div className="mt-8 flex flex-col items-center gap-3 rounded-lg border border-ink-100 bg-surface-raised p-5 text-left">
        <SourceBadge source={interpretation.contentSource} />
        <p className="text-sm leading-relaxed text-ink-700">{interpretation.vernacular}</p>
        <p className="text-sm leading-relaxed text-ink-500">{interpretation.guidance}</p>
        <Disclaimer>{interpretation.disclaimer}</Disclaimer>
      </div>

      <Link to="/my" className="mt-8 inline-block text-sm text-ink-600 underline underline-offset-4">
        回到我的紀錄
      </Link>
    </div>
  );
}
