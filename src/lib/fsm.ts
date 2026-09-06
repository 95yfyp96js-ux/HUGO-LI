import { useCallback, useReducer } from 'react';

/**
 * 輕量型別安全 FSM。設計原因見 ARCHITECTURE.md 決策紀錄：
 * 需要精準控制每個 transition 對應的動畫/音效 side-effect，且不引入額外學習曲線。
 */
export type Transitions<State extends string, Event extends string> = Partial<
  Record<State, Partial<Record<Event, State>>>
>;

interface FsmOptions<State extends string, Event extends string> {
  initial: State;
  transitions: Transitions<State, Event>;
  onTransition?: (from: State, event: Event, to: State) => void;
}

interface FsmState<State extends string> {
  state: State;
  history: State[];
}

export function useFsm<State extends string, Event extends string>({
  initial,
  transitions,
  onTransition,
}: FsmOptions<State, Event>) {
  const [{ state, history }, dispatch] = useReducer(
    (current: FsmState<State>, event: Event): FsmState<State> => {
      const next = transitions[current.state]?.[event];
      if (!next) return current;
      onTransition?.(current.state, event, next);
      return { state: next, history: [...current.history, next] };
    },
    { state: initial, history: [initial] },
  );

  const send = useCallback((event: Event) => dispatch(event), []);

  const can = useCallback(
    (event: Event) => Boolean(transitions[state]?.[event]),
    [state, transitions],
  );

  return { state, history, send, can };
}
