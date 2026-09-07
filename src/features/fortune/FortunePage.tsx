import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useFsm } from '@/lib/fsm';
import { fortuneTransitions } from './machine';
import { useAsync } from '@/lib/useAsync';
import { faithService, MOCK_USER_ID } from '@/services';
import { LoadingState, ErrorState } from '@/components/StateViews';
import { Button } from '@/components/Button';
import { Paper, PaperRule } from '@/components/Paper';
import { SourceBadge } from '@/components/SourceBadge';
import { Disclaimer } from '@/components/Disclaimer';
import { useToast } from '@/components/Toast';
import { CeremonyScreen, RitualLabel } from '@/components/screens';
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
      const timer = setTimeout(() => send('READY'), 900);
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
      const [drawn] = await Promise.all([faithService.drawFortune(deityId, seed), wait(1600)]);
      setStick(drawn);
      audioManager.play('impact');
      send('SHAKE_DONE');
      await wait(900);
      audioManager.play('reveal');
      send('DRAW_DONE');
      // 揭曉前的靜默。這一拍刻意留長，是整段節奏裡最重要的空白。
      await wait(900);
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

  // 籤紙出現後，光要收得更暗——因為此刻畫面上最亮的東西應該是那張紙，不是光暈。
  const showingPaper = state === 'RESULT' || state === 'COMPLETED';
  const intensity = showingPaper ? 0.07 : state === 'REVEALING' ? 0.26 : 0.15;

  if (deityAsync.status === 'loading') {
    return (
      <CeremonyScreen light={{ source: 'flame', x: 50, y: 47, radius: 28, intensity: 0.18 }}>
        <LoadingState label="準備籤筒" />
      </CeremonyScreen>
    );
  }
  if (deityAsync.status === 'error' || !deityAsync.data) {
    return (
      <CeremonyScreen light={{ source: 'flame', x: 50, y: 47, radius: 28, intensity: 0.18 }}>
        <ErrorState
          message="無法進入抽籤體驗"
          onRetry={deityAsync.status === 'error' ? deityAsync.retry : undefined}
        />
      </CeremonyScreen>
    );
  }
  const deity = deityAsync.data;

  return (
    <CeremonyScreen light={{ source: 'flame', x: 50, y: 47, radius: 28, intensity }}>
      <button
        onClick={() => navigate(`/explore/deities/${deityId}`)}
        aria-label="離開"
        className="absolute right-6 top-6 text-xs tracking-wide text-ash-700 transition-colors hover:text-ash-300"
      >
        離開
      </button>

      <AnimatePresence mode="wait">
        {(state === 'IDLE' || state === 'PREPARING') && (
          <motion.p
            key="preparing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-xs tracking-ritual text-ash-700"
          >
            靜心
          </motion.p>
        )}

        {state === 'PRAYER' && (
          <motion.div
            key="prayer"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.ceremony, ease: ease.settle }}
            className="flex w-full max-w-sm flex-col items-center"
          >
            <RitualLabel>請示{deity.name}</RitualLabel>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={120}
              rows={3}
              placeholder="在心中默想想請示的問題"
              className="mt-10 w-full resize-none border-b border-ash-900 pb-3 text-center font-display text-[15px] leading-loose text-ash-100 placeholder:text-ash-700 focus:border-flame/50 focus:outline-none"
            />
            <Button size="lg" onClick={handlePray} className="mt-12">
              搖籤
            </Button>
          </motion.div>
        )}

        {(state === 'SHAKING' || state === 'DRAWING' || state === 'REVEALING') && (
          <motion.div
            key="drawing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center"
          >
            <FortuneVisual state={state} />
            <motion.p
              key={state}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-12 text-xs tracking-ritual text-ash-500"
            >
              {state === 'SHAKING' && '搖籤'}
              {state === 'DRAWING' && ' '}
              {state === 'REVEALING' && stick && `第 ${stick.number} 籤`}
            </motion.p>
          </motion.div>
        )}

        {state === 'RESULT' && stick && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: duration.reveal, ease: ease.ceremony }}
            className="flex w-full max-w-xs flex-col items-center"
          >
            {/* 籤紙。此刻它是畫面上最亮的東西——因為紙就是被光照到的那個實體。 */}
            <Paper torn className="w-full">
              <p className="text-center text-[10px] tracking-ritual text-paper-ink/50">
                第 {stick.number} 籤
              </p>
              <p className="mt-5 text-center font-display text-xl tracking-[0.3em] text-paper-ink">
                {stick.level}
              </p>
              <PaperRule className="my-7" />
              <p className="text-center font-display text-[15px] leading-[2.4] text-paper-ink">
                {stick.poem}
              </p>
            </Paper>
            <Button size="lg" onClick={handleInterpret} className="mt-12">
              白話解讀
            </Button>
          </motion.div>
        )}

        {state === 'INTERPRETATION' && stick && (
          <motion.div
            key="interpretation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: duration.ceremony, ease: ease.settle }}
            className="flex w-full max-w-sm flex-col items-center"
          >
            {interpreting && <LoadingState label="解讀生成中" />}
            {!interpreting && interpretation && (
              <>
                <SourceBadge source={interpretation.contentSource} />
                {/* 解讀不是紙——它是旁人的說明，所以留在夜色裡，不給紙的質感 */}
                <p className="mt-8 text-sm leading-loose text-ash-300">{interpretation.vernacular}</p>
                <p className="mt-6 text-sm leading-loose text-ash-500">{interpretation.guidance}</p>
                <Disclaimer className="mt-10">{interpretation.disclaimer}</Disclaimer>
                <Button size="lg" onClick={handleFinish} className="mt-12">
                  收下這支籤
                </Button>
              </>
            )}
            {!interpreting && !interpretation && (
              <>
                <p className="text-sm text-ash-500">解讀暫時無法取得。</p>
                <Button size="lg" onClick={handleInterpret} className="mt-8">
                  重試
                </Button>
              </>
            )}
          </motion.div>
        )}

        {state === 'COMPLETED' && stick && (
          <motion.div
            key="completed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: duration.reveal, ease: ease.ceremony }}
            className="flex flex-col items-center"
          >
            <RitualLabel>籤已收下</RitualLabel>
            <p className="mt-8 max-w-xs text-sm leading-loose text-ash-500">
              已記錄在您的信仰時光軸中，可隨時回顧。
            </p>
            <div className="mt-16 flex flex-col items-center gap-4">
              <Button onClick={() => navigate(`/lantern/new/${deityId}`)}>為此心願點一盞燈</Button>
              <Button variant="text" onClick={() => navigate('/my')}>
                查看我的紀錄
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </CeremonyScreen>
  );
}
