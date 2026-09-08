import type { Transitions } from '@/lib/fsm';

export type FortuneState =
  | 'IDLE'
  | 'PREPARING'
  | 'PRAYER'
  | 'SHAKING'
  | 'DRAWING'
  | 'REVEALING'
  | 'RESULT'
  | 'INTERPRETATION'
  | 'COMPLETED';

export type FortuneEvent =
  | 'ENTER'
  | 'READY'
  | 'PRAY'
  | 'SHAKE_DONE'
  | 'DRAW_DONE'
  | 'REVEAL_DONE'
  | 'INTERPRET'
  | 'FINISH';

/**
 * 節奏對應 Phase 6：Anticipation → Tension → Silence → Impact → Reveal → Interpretation → Completion
 */
export const fortuneTransitions: Transitions<FortuneState, FortuneEvent> = {
  IDLE: { ENTER: 'PREPARING' },
  PREPARING: { READY: 'PRAYER' },
  PRAYER: { PRAY: 'SHAKING' },
  SHAKING: { SHAKE_DONE: 'DRAWING' },
  DRAWING: { DRAW_DONE: 'REVEALING' },
  REVEALING: { REVEAL_DONE: 'RESULT' },
  RESULT: { INTERPRET: 'INTERPRETATION' },
  INTERPRETATION: { FINISH: 'COMPLETED' },
};
