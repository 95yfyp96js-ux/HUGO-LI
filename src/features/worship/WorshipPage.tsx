import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useFsm } from '@/lib/fsm';
import { worshipTransitions } from './machine';
import { useAsync } from '@/lib/useAsync';
import { faithService, MOCK_USER_ID } from '@/services';
import { LoadingState, ErrorState } from '@/components/StateViews';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
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
      const timer = setTimeout(() => send('READY'), 900);
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

  if (deityAsync.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-dark">
        <LoadingState label="準備神明空間中…" />
      </div>
    );
  }
  if (deityAsync.status === 'error' || !deityAsync.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-dark p-6">
        <ErrorState message="無法進入拜拜體驗" onRetry={deityAsync.status === 'error' ? deityAsync.retry : undefined} />
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
        {(state === 'SELECT_DEITY' || state === 'IDLE') && (
          <motion.div
            key="select"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.standard }}
            className="flex flex-col items-center gap-6 text-center"
          >
            <p className="text-sm text-ink-300">即將前往</p>
            <h1 className="font-display text-3xl font-medium">{deity.name}</h1>
            <p className="max-w-xs text-sm text-ink-300">{deity.title} · {deity.domain.join('・')}</p>
            <Button size="lg" onClick={handleBegin} className="mt-4 bg-surface text-ink-900 hover:bg-ink-100">
              開始拜拜
            </Button>
          </motion.div>
        )}

        {state === 'PREPARING' && (
          <motion.div
            key="preparing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.standard }}
            className="flex flex-col items-center gap-3 text-center"
          >
            <div className="h-8 w-8 animate-pulse rounded-full bg-ember-400/60" />
            <p className="text-sm text-ink-300">正在準備供桌與香案…</p>
          </motion.div>
        )}

        {(state === 'INCENSE' || state === 'WORSHIP') && (
          <motion.div
            key="incense"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.ceremony, ease: ease.ceremony }}
            className="flex flex-col items-center gap-8 text-center"
          >
            <IncenseVisual lit={state === 'WORSHIP'} />
            {state === 'INCENSE' && (
              <Button size="lg" onClick={handleLight} className="bg-surface text-ink-900 hover:bg-ink-100">
                點香
              </Button>
            )}
            {state === 'WORSHIP' && (
              <div className="flex flex-col items-center gap-2">
                <p className="text-sm text-ink-300">靜心片刻，向{deity.name}行禮</p>
                <Button size="lg" onClick={handleBow} className="bg-surface text-ink-900 hover:bg-ink-100">
                  鞠躬獻敬
                </Button>
              </div>
            )}
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
            <p className="text-sm text-ink-300">此刻，向{deity.name}說出心願</p>
            <textarea
              value={wish}
              onChange={(e) => setWish(e.target.value)}
              maxLength={200}
              rows={4}
              placeholder="在心中默念，或寫下您的祈願…"
              className="w-full rounded-md border border-white/15 bg-white/5 p-3 text-sm text-surface placeholder:text-ink-400 focus:border-white/40 focus:outline-none"
            />
            <Button
              size="lg"
              disabled={!wish.trim() || submitting}
              onClick={handleSubmitPrayer}
              className="bg-surface text-ink-900 hover:bg-ink-100"
            >
              {submitting ? '獻上中…' : '獻上祈願'}
            </Button>
          </motion.div>
        )}

        {state === 'COMPLETED' && (
          <motion.div
            key="completed"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: duration.ceremony, ease: ease.ceremony }}
            className="flex flex-col items-center gap-5 text-center"
          >
            <p className="font-display text-xl">祈願已獻上</p>
            <p className="max-w-xs text-sm text-ink-300">
              您的心願已記錄在信仰時光軸中。願此刻的平靜與您同在。
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Button onClick={() => navigate(`/fortune/${deityId}`)} className="bg-surface text-ink-900 hover:bg-ink-100">
                順道求一支籤
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
