import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useFsm } from '@/lib/fsm';
import { lanternTransitions } from './machine';
import { useAsync } from '@/lib/useAsync';
import { faithService, MOCK_USER_ID } from '@/services';
import { LoadingState, ErrorState } from '@/components/StateViews';
import { Button } from '@/components/Button';
import { Paper } from '@/components/Paper';
import { useToast } from '@/components/Toast';
import { CeremonyScreen, RitualLabel } from '@/components/screens';
import { audioManager } from '@/lib/audioManager';
import { duration, ease } from '@/lib/motionTokens';
import type { LampType, Temple } from '@/domain/types';

const LAMP_TYPES: { type: LampType; description: string }[] = [
  { type: '光明燈', description: '祈求整體平安順遂' },
  { type: '平安燈', description: '祈求身體健康、出入平安' },
  { type: '財神燈', description: '祈求財運與事業機會' },
  { type: '文昌燈', description: '祈求考試、學業順利' },
];

export function LanternNewPage() {
  const { deityId } = useParams();
  const navigate = useNavigate();
  const templesAsync = useAsync(() => faithService.getTemples(), []);

  const { state, send } = useFsm({ initial: 'SELECT_TEMPLE', transitions: lanternTransitions });
  const toast = useToast();
  const [temple, setTemple] = useState<Temple | null>(null);
  const [lampType, setLampType] = useState<LampType | null>(null);
  const [wish, setWish] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const availableTemples = useMemo(() => {
    if (templesAsync.status !== 'success') return [];
    if (!deityId) return templesAsync.data;
    const filtered = templesAsync.data.filter((t) => t.deityIds.includes(deityId));
    return filtered.length > 0 ? filtered : templesAsync.data;
  }, [templesAsync, deityId]);

  function chooseTemple(t: Temple) {
    audioManager.play('tap');
    setTemple(t);
    send('CHOOSE_TEMPLE');
  }

  function chooseLamp(type: LampType) {
    audioManager.play('tap');
    setLampType(type);
    send('CHOOSE_LAMP');
  }

  function submitWish() {
    if (!wish.trim()) return;
    audioManager.play('confirm');
    send('SUBMIT_WISH');
  }

  async function confirmLighting() {
    if (!temple || !lampType || submitting) return;
    setSubmitting(true);
    send('CONFIRM');
    try {
      await faithService.createLamp({
        userId: MOCK_USER_ID,
        deityId: deityId ?? temple.deityIds[0],
        templeId: temple.id,
        type: lampType,
        wish: wish.trim(),
      });
      await new Promise((resolve) => setTimeout(resolve, 1400));
      audioManager.play('fire');
      send('LIT_DONE');
      await faithService.saveCeremony({
        userId: MOCK_USER_ID,
        type: 'LAMP',
        refId: temple.id,
        deityId: deityId ?? temple.deityIds[0],
        templeId: temple.id,
        summary: `於${temple.name}點了一盞${lampType}`,
      });
      audioManager.play('completion');
    } catch {
      toast.show('點燈時發生問題，請重新嘗試', 'error');
      navigate('/lantern');
    } finally {
      setSubmitting(false);
    }
  }

  // 這盞燈從還沒點亮（幾乎全黑）到點亮（畫面上唯一的光）——
  // 亮度變化本身就是「願望被記錄下來」的訊號。
  const intensity = state === 'LIGHTING' ? 0.2 : state === 'LIT' || state === 'COMPLETED' ? 0.5 : 0.12;
  // 燭火的照明範圍很小：亮，但只亮一圈。選單步驟時範圍稍大，才看得見選項。
  const radius = state === 'LIT' || state === 'COMPLETED' || state === 'LIGHTING' ? 22 : 34;

  if (templesAsync.status === 'loading') {
    return (
      <CeremonyScreen light={{ source: 'flame', x: 50, y: 46, radius: 30, intensity: 0.16 }}>
        <LoadingState label="準備燈殿" />
      </CeremonyScreen>
    );
  }
  if (templesAsync.status === 'error') {
    return (
      <CeremonyScreen light={{ source: 'flame', x: 50, y: 46, radius: 30, intensity: 0.16 }}>
        <ErrorState message="無法載入寺廟資料" onRetry={templesAsync.retry} />
      </CeremonyScreen>
    );
  }

  return (
    <CeremonyScreen
      light={{
        source: 'flame',
        x: 50,
        // 點亮後把光心對準焰的實際位置，讓光看起來是「從這朵火發出來的」，
        // 而不是一團剛好在附近的光暈。
        y: state === 'LIGHTING' || state === 'LIT' || state === 'COMPLETED' ? 41 : 46,
        radius,
        intensity,
      }}
    >
      <button
        onClick={() => navigate('/lantern')}
        aria-label="離開"
        className="absolute right-6 top-6 text-xs tracking-wide text-ash-700 transition-colors hover:text-ash-300"
      >
        離開
      </button>

      <AnimatePresence mode="wait">
        {state === 'SELECT_TEMPLE' && (
          <motion.div key="temple" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full max-w-xs">
            <RitualLabel>選擇寺廟</RitualLabel>
            <div className="mt-10">
              {availableTemples.map((t) => (
                <button
                  key={t.id}
                  onClick={() => chooseTemple(t)}
                  className="group block w-full border-b border-void-line py-5 text-center"
                >
                  <span className="font-display text-base text-ash-300 transition-colors group-hover:text-flame-core">
                    {t.name}
                  </span>
                  <span className="mt-1.5 block text-[11px] text-ash-700">{t.city}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {state === 'SELECT_LAMP' && (
          <motion.div key="lamp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full max-w-xs">
            <RitualLabel>選擇燈</RitualLabel>
            <div className="mt-10">
              {LAMP_TYPES.map((l) => (
                <button
                  key={l.type}
                  onClick={() => chooseLamp(l.type)}
                  className="group block w-full border-b border-void-line py-5 text-center"
                >
                  <span className="font-display text-base text-ash-300 transition-colors group-hover:text-flame-core">
                    {l.type}
                  </span>
                  <span className="mt-1.5 block text-[11px] text-ash-700">{l.description}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {state === 'PRAYER' && (
          <motion.div key="wish" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex w-full max-w-xs flex-col items-center">
            <RitualLabel>寫下心願</RitualLabel>
            <p className="mt-4 text-[11px] text-ash-700">
              {temple?.name}　{lampType}
            </p>
            {/* 燈的名條是紙做的，所以這裡可以用紙 */}
            <Paper className="mt-8 w-full">
              <textarea
                value={wish}
                onChange={(e) => setWish(e.target.value)}
                maxLength={150}
                rows={4}
                placeholder="寫下想守護的人，或想達成的心願…"
                className="w-full resize-none bg-transparent text-center font-display text-[15px] leading-loose text-paper-ink placeholder:text-paper-ink/35 focus:outline-none"
              />
            </Paper>
            <Button size="lg" className="mt-10" disabled={!wish.trim()} onClick={submitWish}>
              下一步
            </Button>
          </motion.div>
        )}

        {state === 'CONFIRM' && (
          <motion.div key="confirm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex w-full max-w-xs flex-col items-center">
            <RitualLabel>確認</RitualLabel>
            <div className="mt-10 space-y-3 text-sm text-ash-300">
              <p>{temple?.name}</p>
              <p>{lampType}</p>
              <p className="text-ash-500">「{wish}」</p>
            </div>
            <p className="mt-10 text-[11px] leading-relaxed text-ash-700">
              此為原型示意，不涉及真實金流；
              <br />
              正式版本將對應寺廟實際的供品與費用規則。
            </p>
            <Button size="lg" className="mt-10" disabled={submitting} onClick={confirmLighting}>
              點燈
            </Button>
          </motion.div>
        )}

        {(state === 'LIGHTING' || state === 'LIT' || state === 'COMPLETED') && (
          <motion.div key="lighting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center">
            {/* 燈火本身。點亮後用極慢的呼吸，讓它像真的在燃燒而不是在閃爍 */}
            {/* 焰。做成上尖下圓的水滴形而不是正圓——正圓看起來是「一個光點」，水滴才像「一朵火」 */}
            <motion.div
              className="bg-flame-core"
              style={{ borderRadius: '50% 50% 50% 50% / 62% 62% 38% 38%' }}
              animate={
                state === 'LIGHTING'
                  ? { opacity: [0.3, 0.7, 0.35], width: 5, height: 8, scaleY: [1, 1.15, 1] }
                  : { opacity: [0.92, 1, 0.94], width: 9, height: 15, scaleY: [1, 1.06, 1] }
              }
              transition={{
                duration: state === 'LIGHTING' ? 0.9 : 3.6,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
            <p className="mt-16 text-xs tracking-ritual text-ash-500">
              {state === 'LIGHTING' ? '點燈中' : '燈已點亮'}
            </p>

            {state === 'LIT' && (
              <Button size="lg" className="mt-12" onClick={() => send('FINISH')}>
                完成
              </Button>
            )}

            {state === 'COMPLETED' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: duration.reveal, ease: ease.ceremony }}
                className="flex flex-col items-center"
              >
                <p className="mt-8 max-w-[16rem] text-sm leading-loose text-ash-500">
                  這盞燈將持續一年，願它陪伴這份心意。
                </p>
                <div className="mt-14 flex flex-col items-center gap-4">
                  <Button onClick={() => navigate('/lantern')}>查看我的點燈</Button>
                  <Button variant="text" onClick={() => navigate('/my')}>
                    我的紀錄
                  </Button>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </CeremonyScreen>
  );
}
