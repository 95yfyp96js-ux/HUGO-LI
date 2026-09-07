import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useFsm } from '@/lib/fsm';
import { worshipTransitions } from './machine';
import { useAsync } from '@/lib/useAsync';
import { faithService, MOCK_USER_ID } from '@/services';
import { LoadingState, ErrorState } from '@/components/StateViews';
import { Button } from '@/components/Button';
import { Paper } from '@/components/Paper';
import { useToast } from '@/components/Toast';
import { CeremonyScreen, RitualLabel } from '@/components/screens';
import { audioManager } from '@/lib/audioManager';
import { duration, ease } from '@/lib/motionTokens';
import { IncenseVisual } from './IncenseVisual';

export function WorshipPage() {
  const { deityId = '' } = useParams();
  const navigate = useNavigate();
  const deityAsync = useAsync(() => faithService.getDeityById(deityId), [deityId]);

  const { state, send } = useFsm({ initial: 'IDLE', transitions: worshipTransitions });
  const toast = useToast();
  const [wish, setWish] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const hasEntered = useRef(false);

  useEffect(() => {
    if (!hasEntered.current) {
      hasEntered.current = true;
      send('ENTER');
    }
  }, [send]);

  useEffect(() => {
    if (state === 'PREPARING') {
      const timer = setTimeout(() => send('READY'), 1200);
      return () => clearTimeout(timer);
    }
  }, [state, send]);

  async function handleBegin() {
    await audioManager.resumeOnUserGesture();
    audioManager.play('confirm');
    send('CONFIRM');
  }

  function handleLight() {
    audioManager.play('incense');
    send('LIGHT');
  }

  function handleBow() {
    audioManager.play('wood');
    send('BOW');
  }

  async function handleSubmitPrayer() {
    if (submitting || !wish.trim()) return;
    setSubmitting(true);
    try {
      const prayer = await faithService.createPrayer({
        userId: MOCK_USER_ID,
        deityId,
        wish: wish.trim(),
      });
      await faithService.saveCeremony({
        userId: MOCK_USER_ID,
        type: 'WORSHIP',
        refId: prayer.id,
        deityId,
        summary: `向${deityAsync.status === 'success' ? deityAsync.data?.name ?? '神明' : '神明'}獻上祈願`,
      });
      audioManager.play('chime');
      send('SUBMIT');
    } catch {
      toast.show('祈願獻上失敗，請再試一次', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  // 光源全程固定在香爐的位置（畫面中央偏下），並隨儀式進行變亮——
  // 光沒有移動，是我們越走越近。
  const litIntensity = state === 'INCENSE' ? 0.1 : state === 'IDLE' || state === 'SELECT_DEITY' ? 0.08 : 0.2;

  if (deityAsync.status === 'loading') {
    return (
      <CeremonyScreen light={{ source: 'ember', x: 50, y: 54, radius: 26, intensity: 0.16 }}>
        <LoadingState label="準備神明空間" />
      </CeremonyScreen>
    );
  }
  if (deityAsync.status === 'error' || !deityAsync.data) {
    return (
      <CeremonyScreen light={{ source: 'ember', x: 50, y: 54, radius: 26, intensity: 0.16 }}>
        <ErrorState
          message="無法進入拜拜體驗"
          onRetry={deityAsync.status === 'error' ? deityAsync.retry : undefined}
        />
      </CeremonyScreen>
    );
  }
  const deity = deityAsync.data;

  return (
    <CeremonyScreen light={{ source: 'ember', x: 50, y: 54, radius: 26, intensity: litIntensity }}>
      <button
        onClick={() => navigate(`/explore/deities/${deityId}`)}
        aria-label="離開"
        className="absolute right-6 top-6 text-xs tracking-wide text-ash-700 transition-colors hover:text-ash-300"
      >
        離開
      </button>

      <AnimatePresence mode="wait">
        {(state === 'SELECT_DEITY' || state === 'IDLE') && (
          <motion.div
            key="select"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.ceremony }}
            className="flex flex-col items-center"
          >
            <RitualLabel>{deity.title}</RitualLabel>
            <h1 className="mt-8 font-display text-4xl font-medium tracking-[0.2em] text-ash-100">
              {deity.name}
            </h1>
            <p className="mt-6 text-xs tracking-wide text-ash-700">{deity.domain.join('　')}</p>
            <Button size="lg" onClick={handleBegin} className="mt-16">
              上香
            </Button>
          </motion.div>
        )}

        {state === 'PREPARING' && (
          <motion.p
            key="preparing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.ceremony }}
            className="text-xs tracking-ritual text-ash-700"
          >
            靜心
          </motion.p>
        )}

        {(state === 'INCENSE' || state === 'WORSHIP') && (
          <motion.div
            key="incense"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.ceremony, ease: ease.ceremony }}
            className="flex flex-col items-center"
          >
            <IncenseVisual lit={state === 'WORSHIP'} />
            {state === 'INCENSE' && (
              <Button size="lg" onClick={handleLight} className="mt-14">
                點香
              </Button>
            )}
            {state === 'WORSHIP' && (
              <>
                <p className="mt-14 text-xs tracking-ritual text-ash-500">向{deity.name}行禮</p>
                <Button size="lg" onClick={handleBow} className="mt-8">
                  鞠躬
                </Button>
              </>
            )}
          </motion.div>
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
            <RitualLabel>祈願</RitualLabel>
            {/* 願望寫在紙上——這是全站少數「真的是紙」的東西之一 */}
            <Paper className="mt-8 w-full">
              <textarea
                value={wish}
                onChange={(e) => setWish(e.target.value)}
                maxLength={200}
                rows={5}
                placeholder="在心中默念，或寫下您的祈願…"
                className="w-full resize-none bg-transparent text-center font-display text-[15px] leading-loose text-paper-ink placeholder:text-paper-ink/35 focus:outline-none"
              />
            </Paper>
            <Button size="lg" disabled={!wish.trim() || submitting} onClick={handleSubmitPrayer} className="mt-10">
              {submitting ? '獻上中' : '獻上'}
            </Button>
          </motion.div>
        )}

        {state === 'COMPLETED' && (
          <motion.div
            key="completed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: duration.reveal, ease: ease.ceremony }}
            className="flex flex-col items-center"
          >
            <RitualLabel>祈願已獻上</RitualLabel>
            <p className="mt-8 max-w-xs text-sm leading-loose text-ash-500">
              您的心願已記錄在信仰時光軸中。
            </p>
            <div className="mt-16 flex flex-col items-center gap-4">
              <Button onClick={() => navigate(`/fortune/${deityId}`)}>順道求一支籤</Button>
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
