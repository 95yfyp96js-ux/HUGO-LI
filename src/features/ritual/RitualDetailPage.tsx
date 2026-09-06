import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useFsm } from '@/lib/fsm';
import { ritualTransitions } from './machine';
import { useAsync } from '@/lib/useAsync';
import { faithService, MOCK_USER_ID } from '@/services';
import { LoadingState, ErrorState } from '@/components/StateViews';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Disclaimer } from '@/components/Disclaimer';
import { useToast } from '@/components/Toast';
import { riseIn } from '@/lib/motionTokens';
import type { RitualBooking } from '@/domain/types';

export function RitualDetailPage() {
  const { ritualId = '' } = useParams();
  const navigate = useNavigate();
  const ritualAsync = useAsync(() => faithService.getRitualById(ritualId), [ritualId]);

  const { state, send } = useFsm({ initial: 'EXPLANATION', transitions: ritualTransitions });
  const toast = useToast();
  const [acknowledged, setAcknowledged] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [booking, setBooking] = useState<RitualBooking | null>(null);

  useEffect(() => {
    if (state === 'COMPLETED') {
      const timer = setTimeout(() => send('VIEW_RECORD'), 900);
      return () => clearTimeout(timer);
    }
  }, [state, send]);

  if (ritualAsync.status === 'loading') return <LoadingState label="載入儀式說明中…" />;
  if (ritualAsync.status === 'error' || !ritualAsync.data) {
    return <ErrorState message="無法載入儀式資訊" onRetry={ritualAsync.status === 'error' ? ritualAsync.retry : undefined} />;
  }
  const ritual = ritualAsync.data;

  async function handleConfirmBooking() {
    if (submitting) return;
    setSubmitting(true);
    send('CONFIRM');
    try {
      const result = await faithService.createRitualBooking({
        userId: MOCK_USER_ID,
        ritualId: ritual.id,
        templeId: ritual.templeId,
        contactName,
        contactPhone,
        note: note.trim() || undefined,
      });
      setBooking(result);
      await faithService.saveCeremony({
        userId: MOCK_USER_ID,
        type: 'RITUAL',
        refId: result.id,
        templeId: ritual.templeId,
        summary: `預約了「${ritual.name}」，待寺廟確認`,
      });
      send('DONE');
    } catch {
      toast.show('預約送出失敗，請重新嘗試', 'error');
      navigate('/ritual');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.div {...riseIn} className="mx-auto max-w-md px-4 py-10">
      {state === 'EXPLANATION' && (
        <>
          <h1 className="font-display text-xl font-medium text-ink-900">{ritual.name}</h1>
          <p className="mt-4 text-sm leading-relaxed text-ink-700">{ritual.description}</p>
          <p className="mt-3 text-sm leading-relaxed text-ink-600">{ritual.applicabilityNotes}</p>
          <Disclaimer className="mt-4">{ritual.disclaimer}</Disclaimer>
          <Button size="lg" className="mt-6" onClick={() => send('NEXT')}>
            了解適用性
          </Button>
        </>
      )}

      {state === 'APPLICABILITY' && (
        <>
          <h1 className="font-display text-xl font-medium text-ink-900">在預約前，請先確認</h1>
          <Card className="mt-4 p-4">
            <label className="flex items-start gap-3 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-1"
              />
              <span>
                我了解此儀式須由寺廟人員現場執行，本平台僅提供說明與預約入口，不保證任何消災、改運或治療效果。
              </span>
            </label>
          </Card>
          <Button size="lg" className="mt-6" disabled={!acknowledged} onClick={() => send('ACKNOWLEDGE')}>
            繼續預約
          </Button>
        </>
      )}

      {state === 'FORM' && (
        <>
          <h1 className="font-display text-xl font-medium text-ink-900">填寫聯絡資訊</h1>
          <div className="mt-4 flex flex-col gap-3">
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="聯絡人姓名"
              className="rounded-md border border-ink-200 p-3 text-sm focus:border-ink-500 focus:outline-none"
            />
            <input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="聯絡電話"
              inputMode="tel"
              className="rounded-md border border-ink-200 p-3 text-sm focus:border-ink-500 focus:outline-none"
            />
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="（選填）想補充說明的狀況"
              rows={3}
              className="rounded-md border border-ink-200 p-3 text-sm focus:border-ink-500 focus:outline-none"
            />
          </div>
          <Button
            size="lg"
            className="mt-6"
            disabled={!contactName.trim() || !contactPhone.trim()}
            onClick={() => send('SUBMIT_FORM')}
          >
            下一步
          </Button>
        </>
      )}

      {state === 'CONFIRM' && (
        <>
          <h1 className="font-display text-xl font-medium text-ink-900">確認預約資訊</h1>
          <Card className="mt-4 p-4">
            <p className="text-sm text-ink-700">儀式：{ritual.name}</p>
            <p className="mt-1 text-sm text-ink-700">聯絡人：{contactName}</p>
            <p className="mt-1 text-sm text-ink-700">電話：{contactPhone}</p>
            {note && <p className="mt-1 text-sm text-ink-700">備註：{note}</p>}
          </Card>
          <Disclaimer className="mt-4">
            送出後為「待寺廟確認」狀態，本平台不代表寺廟做出任何效果承諾。
          </Disclaimer>
          <Button size="lg" className="mt-6" disabled={submitting} onClick={handleConfirmBooking}>
            {submitting ? '送出中…' : '送出預約'}
          </Button>
        </>
      )}

      {(state === 'PROCESSING' || state === 'COMPLETED') && (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-ink-200 border-t-ink-600" />
          <p className="text-sm text-ink-500">正在送出您的預約…</p>
        </div>
      )}

      {state === 'RECORD' && booking && (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <p className="font-display text-lg text-ink-900">預約已送出</p>
          <p className="max-w-xs text-sm text-ink-500">
            狀態：待寺廟確認。已記錄在您的信仰時光軸中，寺廟聯繫方式與後續流程屬於未來真實串接範圍。
          </p>
          <div className="mt-2 flex gap-2">
            <Link to="/my">
              <Button>查看我的紀錄</Button>
            </Link>
            <Button variant="secondary" onClick={() => navigate('/ritual')}>
              回到儀式列表
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
