import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useFsm } from '@/lib/fsm';
import { fortuneTransitions } from './machine';
import { useAsync } from '@/lib/useAsync';
import { faithService, MOCK_USER_ID } from '@/services';
import { LoadingState, ErrorState } from '@/components/StateViews';
import { Button } from '@/components/Button';
import { SourceBadge } from '@/components/SourceBadge';
import { Disclaimer } from '@/components/Disclaimer';
import { useToast } from '@/components/Toast';
import { audioManager } from '@/lib/audioManager';
import { duration, ease } from '@/lib/motionTokens';
import { seedFromString } from '@/lib/deterministicRandom';
import { FortuneVisual } from './FortuneVisual';
import type { FortuneInterpretation, FortuneStick } from '@/domain/types';

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function FortunePage() {
  const { deityId = '' } = useParams();
  const navigate = useNavigate();
  const deityAsync = useAsync(() => faithService.getDeityById(deityId), [deityId]);

  const { state, send } = useFsm({ initial: 'IDLE', transitions: fortuneTransitions });
  const toast = useToast();
  const [question, setQuestion] = useState('');
  const [stick, setStick] = useState<FortuneStick | null>(null);
  const [interpretation, setInterpretation] = useState<FortuneInterpretation | null>(null);
  const [interpreting, setInterpreting] = useState(false);
  const ranDraw = useRef(false);
  const hasEntered = useRef(false);

  useEffect(() => {
    if (!hasEntered.current) {
      hasEntered.current = true;
      send('ENTER');
    }
  }, [send]);

  useEffect(() => {
    if (state === 'PREPARING') {
      const timer = setTimeout(() => send('READY'), 700);
      return () => clearTimeout(timer);
    }
  }, [state, send]);

  useEffect(() => {
    if (state === 'SHAKING' && !ranDraw.current) {
      ranDraw.current = true;
      void runDraw();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  async function runDraw() {
    audioManager.play('shake');
    try {
      const seed = seedFromString(`${deityId}-${question}-${Date.now()}`);
      const [drawn] = await Promise.all([faithService.drawFortune(deityId, seed), wait(1400)]);
      setStick(drawn);
      audioManager.play('impact');
      send('SHAKE_DONE');
      await wait(800);
      audioManager.play('reveal');
      send('DRAW_DONE');
      await wait(600);
      send('REVEAL_DONE');
    } catch {
      toast.show('搖籤時發生問題，請重新進入求籤', 'error');
      navigate(`/explore/deities/${deityId}`);
    }
  }

  async function handlePray() {
    await audioManager.resumeOnUserGesture();
    audioManager.play('confirm');
    send('PRAY');
  }

  async function handleInterpret() {
    if (!stick) return;
    send('INTERPRET');
    setInterpreting(true);
    try {
      const result = await faithService.interpretFortune(stick);
      setInterpretation(result);
    } catch {
      toast.show('解讀生成失敗，請稍後再試', 'error');
    } finally {
      setInterpreting(false);
    }
  }

  async function handleFinish() {
    if (!stick) return;
    try {
      await faithService.saveCeremony({
        userId: MOCK_USER_ID,
        type: 'FORTUNE',
        refId: stick.id,
        deityId,
        summary: `求得第 ${stick.number} 籤（${stick.level}）`,
      });
      audioManager.play('completion');
      send('FINISH');
    } catch {
      toast.show('紀錄儲存失敗，請再試一次', 'error');
    }
  }

  if (deityAsync.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-dark">
        <LoadingState label="準備籤筒中…" />
      </div>
    );
  }
  if (deityAsync.status === 'error' || !deityAsync.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-dark p-6">
        <ErrorState message="無法進入抽籤體驗" onRetry={deityAsync.status === 'error' ? deityAsync.retry : undefined} />
      </div>
    );
  }
  const deity = deityAsync.data;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-surface-dark px-6 py-10 text-surface">
      <button
        onClick={() => navigate(`/explore/deities/${deityId}`)}
        aria-label="關閉"
        className="absolute right-4 top-4 rounded-full p-2 text-ink-300 hover:bg-white/5 hover:text-surface"
      >
        ✕
      </button>

      <AnimatePresence mode="wait">
        {(state === 'IDLE' || state === 'PREPARING') && (
          <motion.div
            key="preparing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-3 text-center"
          >
            <div className="h-8 w-8 animate-pulse rounded-full bg-ember-400/60" />
            <p className="text-sm text-ink-300">正在準備{deity.name}的籤筒…</p>
          </motion.div>
        )}

        {state === 'PRAYER' && (
          <motion.div
            key="prayer"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.standard, ease: ease.settle }}
            className="flex w-full max-w-sm flex-col items-center gap-4 text-center"
          >
            <p className="text-sm text-ink-300">在心中默想您想請示{deity.name}的問題</p>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={120}
              rows={3}
              placeholder="（選填）寫下想請示的問題…"
              className="w-full rounded-md border border-white/15 bg-white/5 p-3 text-sm text-surface placeholder:text-ink-400 focus:border-white/40 focus:outline-none"
            />
            <Button size="lg" onClick={handlePray} className="bg-surface text-ink-900 hover:bg-ink-100">
              開始搖籤
            </Button>
          </motion.div>
        )}

        {(state === 'SHAKING' || state === 'DRAWING' || state === 'REVEALING') && (
          <motion.div
            key="drawing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-6 text-center"
          >
            <FortuneVisual state={state} />
            <p className="text-sm text-ink-300">
              {state === 'SHAKING' && '靜心搖籤中…'}
              {state === 'DRAWING' && '一支籤緩緩浮現…'}
              {state === 'REVEALING' && stick && `第 ${stick.number} 籤`}
            </p>
          </motion.div>
        )}

        {state === 'RESULT' && stick && (
          <motion.div
            key="result"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: duration.ceremony, ease: ease.ceremony }}
            className="flex w-full max-w-sm flex-col items-center gap-4 text-center"
          >
            <p className="text-xs text-ink-400">第 {stick.number} 籤</p>
            <p className="font-display text-xl">{stick.level}</p>
            <p className="max-w-xs text-sm leading-loose text-ink-200">{stick.poem}</p>
            <Button size="lg" onClick={handleInterpret} className="mt-2 bg-surface text-ink-900 hover:bg-ink-100">
              查看白話解讀
            </Button>
          </motion.div>
        )}

        {state === 'INTERPRETATION' && stick && (
          <motion.div
            key="interpretation"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: duration.standard, ease: ease.settle }}
            className="flex w-full max-w-sm flex-col items-center gap-4 text-center"
          >
            {interpreting && <LoadingState label="AI 輔助解讀生成中…" />}
            {!interpreting && interpretation && (
              <>
                <SourceBadge source={interpretation.contentSource} />
                <p className="text-sm leading-relaxed text-ink-100">{interpretation.vernacular}</p>
                <p className="text-sm leading-relaxed text-ink-300">{interpretation.guidance}</p>
                <Disclaimer className="bg-white/5 text-ink-300">{interpretation.disclaimer}</Disclaimer>
                <Button size="lg" onClick={handleFinish} className="mt-2 bg-surface text-ink-900 hover:bg-ink-100">
                  完成
                </Button>
              </>
            )}
            {!interpreting && !interpretation && (
              <>
                <p className="text-sm text-ink-300">解讀暫時無法取得。</p>
                <Button size="lg" onClick={handleInterpret} className="bg-surface text-ink-900 hover:bg-ink-100">
                  重試
                </Button>
              </>
            )}
          </motion.div>
        )}

        {state === 'COMPLETED' && stick && (
          <motion.div
            key="completed"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: duration.ceremony, ease: ease.ceremony }}
            className="flex flex-col items-center gap-5 text-center"
          >
            <p className="font-display text-xl">籤詩已收藏</p>
            <p className="max-w-xs text-sm text-ink-300">已記錄在您的信仰時光軸中，可隨時回顧。</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Button onClick={() => navigate(`/lantern/new/${deityId}`)} className="bg-surface text-ink-900 hover:bg-ink-100">
                為此心願點一盞燈
              </Button>
              <Button variant="secondary" onClick={() => navigate('/my')} className="border-white/30 text-surface hover:border-white/60">
                查看我的紀錄
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
