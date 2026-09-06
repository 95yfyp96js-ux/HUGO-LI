import type { Transitions } from '@/lib/fsm';

export type LanternState =
  | 'SELECT_TEMPLE'
  | 'SELECT_LAMP'
  | 'PRAYER'
  | 'CONFIRM'
  | 'LIGHTING'
  | 'LIT'
  | 'COMPLETED';

export type LanternEvent = 'CHOOSE_TEMPLE' | 'CHOOSE_LAMP' | 'SUBMIT_WISH' | 'CONFIRM' | 'LIT_DONE' | 'FINISH';

export const lanternTransitions: Transitions<LanternState, LanternEvent> = {
  SELECT_TEMPLE: { CHOOSE_TEMPLE: 'SELECT_LAMP' },
  SELECT_LAMP: { CHOOSE_LAMP: 'PRAYER' },
  PRAYER: { SUBMIT_WISH: 'CONFIRM' },
  CONFIRM: { CONFIRM: 'LIGHTING' },
  LIGHTING: { LIT_DONE: 'LIT' },
  LIT: { FINISH: 'COMPLETED' },
};
