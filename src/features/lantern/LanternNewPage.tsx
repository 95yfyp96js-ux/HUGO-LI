import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useFsm } from '@/lib/fsm';
import { lanternTransitions } from './machine';
import { useAsync } from '@/lib/useAsync';
import { faithService, MOCK_USER_ID } from '@/services';
import { LoadingState, ErrorState } from '@/components/StateViews';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useToast } from '@/components/Toast';
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
      await new Promise((resolve) => setTimeout(resolve, 1000));
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

  if (templesAsync.status === 'loading') return <LoadingState label="準備點燈殿堂中…" />;
  if (templesAsync.status === 'error') {
    return <ErrorState message="無法載入寺廟資料" onRetry={templesAsync.retry} />;
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <AnimatePresence mode="wait">
        {state === 'SELECT_TEMPLE' && (
          <motion.div key="temple" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <h1 className="font-display text-xl font-medium text-ink-900">選擇寺廟</h1>
            <div className="mt-4 flex flex-col gap-2">
              {availableTemples.map((t) => (
                <button key={t.id} onClick={() => chooseTemple(t)} className="text-left">
                  <Card className="p-4 transition-shadow hover:shadow-raised">
                    <p className="font-medium text-ink-900">{t.name}</p>
                    <p className="text-xs text-ink-500">{t.city}</p>
                  </Card>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {state === 'SELECT_LAMP' && (
          <motion.div key="lamp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <h1 className="font-display text-xl font-medium text-ink-900">選擇燈的種類</h1>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {LAMP_TYPES.map((l) => (
                <button key={l.type} onClick={() => chooseLamp(l.type)} className="text-left">
                  <Card className="p-4 transition-shadow hover:shadow-raised">
                    <p className="font-medium text-ink-900">{l.type}</p>
                    <p className="mt-1 text-xs text-ink-500">{l.description}</p>
                  </Card>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {state === 'PRAYER' && (
          <motion.div key="wish" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <h1 className="font-display text-xl font-medium text-ink-900">寫下您的心願</h1>
            <p className="mt-1 text-sm text-ink-500">
              於{temple?.name} · {lampType}
            </p>
            <textarea
              value={wish}
              onChange={(e) => setWish(e.target.value)}
              maxLength={150}
              rows={4}
              placeholder="寫下想守護的人，或想達成的心願…"
              className="mt-4 w-full rounded-md border border-ink-200 p-3 text-sm focus:border-ink-500 focus:outline-none"
            />
            <Button size="lg" className="mt-4" disabled={!wish.trim()} onClick={submitWish}>
              下一步
            </Button>
          </motion.div>
        )}

        {state === 'CONFIRM' && (
          <motion.div key="confirm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <h1 className="font-display text-xl font-medium text-ink-900">確認點燈</h1>
            <Card className="mt-4 p-4">
              <p className="text-sm text-ink-700">寺廟：{temple?.name}</p>
              <p className="mt-1 text-sm text-ink-700">燈種：{lampType}</p>
              <p className="mt-1 text-sm text-ink-700">心願：「{wish}」</p>
            </Card>
            <p className="mt-3 text-xs text-ink-400">
              此為原型示意，不涉及真實金流；正式版本的點燈將對應寺廟實際供品/費用規則。
            </p>
            <Button size="lg" className="mt-4" disabled={submitting} onClick={confirmLighting}>
              {submitting ? '點燈中…' : '確認點燈'}
            </Button>
          </motion.div>
        )}

        {(state === 'LIGHTING' || state === 'LIT') && (
          <motion.div
            key="lighting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-4 py-10 text-center"
          >
            <motion.div
              className="h-16 w-16 rounded-full bg-gold-400"
              animate={
                state === 'LIT'
                  ? { opacity: [0.7, 1, 0.85], scale: [1, 1.06, 1] }
                  : { opacity: [0.2, 0.5, 0.2] }
              }
              transition={{ duration: state === 'LIT' ? 2.2 : 0.9, repeat: Infinity, ease: 'easeInOut' }}
            />
            <p className="text-sm text-ink-500">
              {state === 'LIGHTING' ? '正在為您點亮這盞燈…' : '燈已點亮'}
            </p>
            {state === 'LIT' && (
              <Button size="lg" onClick={() => send('FINISH')}>
                完成
              </Button>
            )}
          </motion.div>
        )}

        {state === 'COMPLETED' && (
          <motion.div
            key="completed"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: duration.ceremony, ease: ease.ceremony }}
            className="flex flex-col items-center gap-4 py-10 text-center"
          >
            <p className="font-display text-lg text-ink-900">您的心願已被記錄</p>
            <p className="max-w-xs text-sm text-ink-500">這盞燈將持續一年，願它陪伴這份心意。</p>
            <div className="mt-2 flex gap-2">
              <Button onClick={() => navigate('/lantern')}>查看我的點燈</Button>
              <Button variant="secondary" onClick={() => navigate('/my')}>
                我的紀錄
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
