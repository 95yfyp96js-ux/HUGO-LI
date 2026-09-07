import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useFsm } from '@/lib/fsm';
import { ritualTransitions } from './machine';
import { useAsync } from '@/lib/useAsync';
import { faithService, MOCK_USER_ID } from '@/services';
import { LoadingState, ErrorState } from '@/components/StateViews';
import { Button } from '@/components/Button';
import { Panel } from '@/components/Card';
import { Disclaimer } from '@/components/Disclaimer';
import { useToast } from '@/components/Toast';
import { PageScreen } from '@/components/screens';
import type { RitualBooking } from '@/domain/types';

const FIELD_CLASS =
  'w-full border-b border-ash-900 bg-transparent pb-3 text-sm text-ash-100 placeholder:text-ash-700 focus:border-flame/50 focus:outline-none';

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

  if (ritualAsync.status === 'loading') {
    return (
      <PageScreen>
        <LoadingState label="載入中" />
      </PageScreen>
    );
  }
  if (ritualAsync.status === 'error' || !ritualAsync.data) {
    return (
      <PageScreen>
        <ErrorState
          message="無法載入儀式資訊"
          onRetry={ritualAsync.status === 'error' ? ritualAsync.retry : undefined}
        />
      </PageScreen>
    );
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
    <PageScreen light={{ source: 'flame', x: 4, y: -10, radius: 40, intensity: 0.07 }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
        {state === 'EXPLANATION' && (
          <>
            <h1 className="font-display text-2xl font-medium tracking-wide text-ash-100">{ritual.name}</h1>
            <p className="mt-8 max-w-md text-sm leading-loose text-ash-300">{ritual.description}</p>
            <p className="mt-6 max-w-md text-sm leading-loose text-ash-500">{ritual.applicabilityNotes}</p>
            <Disclaimer className="mt-8">{ritual.disclaimer}</Disclaimer>
            <Button variant="quiet" size="lg" className="mt-12" onClick={() => send('NEXT')}>
              了解適用性
            </Button>
          </>
        )}

        {state === 'APPLICABILITY' && (
          <>
            <h1 className="font-display text-xl font-medium tracking-wide text-ash-100">在預約前，請先確認</h1>
            <Panel className="mt-8">
              <label className="flex items-start gap-4 text-sm leading-relaxed text-ash-300">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-1.5 accent-flame"
                />
                <span>
                  我了解此儀式須由寺廟人員現場執行，本平台僅提供說明與預約入口，不保證任何消災、改運或治療效果。
                </span>
              </label>
            </Panel>
            <Button variant="quiet" size="lg" className="mt-12" disabled={!acknowledged} onClick={() => send('ACKNOWLEDGE')}>
              繼續預約
            </Button>
          </>
        )}

        {state === 'FORM' && (
          <>
            <h1 className="font-display text-xl font-medium tracking-wide text-ash-100">填寫聯絡資訊</h1>
            <div className="mt-10 flex max-w-sm flex-col gap-8">
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="聯絡人姓名"
                className={FIELD_CLASS}
              />
              <input
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="聯絡電話"
                inputMode="tel"
                className={FIELD_CLASS}
              />
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="（選填）想補充說明的狀況"
                rows={3}
                className={FIELD_CLASS + ' resize-none'}
              />
            </div>
            <Button
              variant="quiet"
              size="lg"
              className="mt-12"
              disabled={!contactName.trim() || !contactPhone.trim()}
              onClick={() => send('SUBMIT_FORM')}
            >
              下一步
            </Button>
          </>
        )}

        {state === 'CONFIRM' && (
          <>
            <h1 className="font-display text-xl font-medium tracking-wide text-ash-100">確認預約資訊</h1>
            <Panel className="mt-8 max-w-sm space-y-3 text-sm text-ash-300">
              <p>儀式　{ritual.name}</p>
              <p>聯絡人　{contactName}</p>
              <p>電話　{contactPhone}</p>
              {note && <p>備註　{note}</p>}
            </Panel>
            <Disclaimer className="mt-8">
              送出後為「待寺廟確認」狀態，本平台不代表寺廟做出任何效果承諾。
            </Disclaimer>
            <Button variant="quiet" size="lg" className="mt-12" disabled={submitting} onClick={handleConfirmBooking}>
              {submitting ? '送出中' : '送出預約'}
            </Button>
          </>
        )}

        {(state === 'PROCESSING' || state === 'COMPLETED') && <LoadingState label="送出中" />}

        {state === 'RECORD' && booking && (
          <>
            <h1 className="font-display text-xl font-medium tracking-wide text-ash-100">預約已送出</h1>
            <p className="mt-8 max-w-md text-sm leading-loose text-ash-500">
              狀態：待寺廟確認。已記錄在您的信仰時光軸中。寺廟聯繫方式與後續流程屬於未來真實串接範圍。
            </p>
            <div className="mt-12 flex items-center gap-8">
              <Link to="/my" className="text-[13px] text-ash-300 transition-colors hover:text-ash-100">
                查看我的紀錄
              </Link>
              <Link to="/ritual" className="text-[13px] text-ash-700 transition-colors hover:text-ash-300">
                回到儀式列表
              </Link>
            </div>
          </>
        )}
      </motion.div>
    </PageScreen>
  );
}
