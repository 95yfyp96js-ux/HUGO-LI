import type { Transitions } from '@/lib/fsm';

export type WorshipState =
  | 'IDLE'
  | 'SELECT_DEITY'
  | 'PREPARING'
  | 'INCENSE'
  | 'WORSHIP'
  | 'PRAYER'
  | 'COMPLETED';

export type WorshipEvent = 'ENTER' | 'CONFIRM' | 'READY' | 'LIGHT' | 'BOW' | 'SUBMIT' | 'RESTART';

export const worshipTransitions: Transitions<WorshipState, WorshipEvent> = {
  IDLE: { ENTER: 'SELECT_DEITY' },
  SELECT_DEITY: { CONFIRM: 'PREPARING' },
  PREPARING: { READY: 'INCENSE' },
  INCENSE: { LIGHT: 'WORSHIP' },
  WORSHIP: { BOW: 'PRAYER' },
  PRAYER: { SUBMIT: 'COMPLETED' },
  COMPLETED: { RESTART: 'SELECT_DEITY' },
};
