import type { Transitions } from '@/lib/fsm';

export type RitualState =
  | 'EXPLANATION'
  | 'APPLICABILITY'
  | 'FORM'
  | 'CONFIRM'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'RECORD';

export type RitualEvent = 'NEXT' | 'ACKNOWLEDGE' | 'SUBMIT_FORM' | 'CONFIRM' | 'DONE' | 'VIEW_RECORD';

/**
 * 這是敏感功能（Phase 6）：全程不做遊戲化，只做「了解 → 確認適用性 → 填表 → 預約」，
 * 且 APPLICABILITY 步驟強制使用者確認理解免責聲明才能繼續。
 */
export const ritualTransitions: Transitions<RitualState, RitualEvent> = {
  EXPLANATION: { NEXT: 'APPLICABILITY' },
  APPLICABILITY: { ACKNOWLEDGE: 'FORM' },
  FORM: { SUBMIT_FORM: 'CONFIRM' },
  CONFIRM: { CONFIRM: 'PROCESSING' },
  PROCESSING: { DONE: 'COMPLETED' },
  COMPLETED: { VIEW_RECORD: 'RECORD' },
};
