import { Link, useParams } from 'react-router-dom';
import { useAsync } from '@/lib/useAsync';
import { faithService, MOCK_USER_ID } from '@/services';
import { LoadingState, ErrorState } from '@/components/StateViews';
import { SourceBadge } from '@/components/SourceBadge';
import { Disclaimer } from '@/components/Disclaimer';
import { Paper, PaperRule } from '@/components/Paper';
import { PageScreen } from '@/components/screens';

/** 從 refId（格式 `${deityId}-stick-${n}`）反推 deityId，避免額外新增 service 方法。 */
function parseDeityIdFromStickId(stickId: string): string | null {
  const match = stickId.match(/^(.*)-stick-\d+$/);
  return match ? match[1] : null;
}

/**
 * 從紀錄回看一支籤。
 * 頁面本身屬於「管理／瀏覽」，所以靠左；
 * 但那張籤紙仍然是紙，所以仍然用紙的質感——規則是綁在「物件」上，不是綁在「頁面」上。
 */
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

  if (dataAsync.status === 'loading') {
    return (
      <PageScreen>
        <LoadingState label="載入中" />
      </PageScreen>
    );
  }
  if (dataAsync.status === 'error') {
    return (
      <PageScreen>
        <ErrorState message={dataAsync.error.message} onRetry={dataAsync.retry} />
      </PageScreen>
    );
  }

  const { entry, stick, interpretation } = dataAsync.data;

  return (
    <PageScreen>
      <p className="text-[11px] tracking-wide text-ash-700">
        {new Date(entry.timestamp).toLocaleString('zh-TW')}
      </p>

      <Paper torn className="mt-8 max-w-xs">
        <p className="text-center text-[10px] tracking-ritual text-paper-ink/50">第 {stick.number} 籤</p>
        <p className="mt-5 text-center font-display text-xl tracking-[0.3em] text-paper-ink">
          {stick.level}
        </p>
        <PaperRule className="my-7" />
        <p className="text-center font-display text-[15px] leading-[2.4] text-paper-ink">{stick.poem}</p>
      </Paper>

      <div className="mt-12 max-w-md">
        <SourceBadge source={interpretation.contentSource} />
        <p className="mt-6 text-sm leading-loose text-ash-300">{interpretation.vernacular}</p>
        <p className="mt-5 text-sm leading-loose text-ash-500">{interpretation.guidance}</p>
        <Disclaimer className="mt-8">{interpretation.disclaimer}</Disclaimer>
      </div>

      <Link
        to="/my"
        className="mt-14 inline-block text-[13px] text-ash-500 transition-colors hover:text-ash-100"
      >
        回到我的紀錄
      </Link>
    </PageScreen>
  );
}
