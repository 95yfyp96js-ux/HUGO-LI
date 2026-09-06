import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFsm } from './fsm';

type S = 'A' | 'B' | 'C';
type E = 'NEXT' | 'BACK';

const transitions = {
  A: { NEXT: 'B' },
  B: { NEXT: 'C', BACK: 'A' },
  C: {},
} as const;

describe('useFsm', () => {
  it('transitions through defined states', () => {
    const { result } = renderHook(() => useFsm<S, E>({ initial: 'A', transitions }));
    expect(result.current.state).toBe('A');

    act(() => result.current.send('NEXT'));
    expect(result.current.state).toBe('B');

    act(() => result.current.send('NEXT'));
    expect(result.current.state).toBe('C');
  });

  it('ignores events with no defined transition', () => {
    const { result } = renderHook(() => useFsm<S, E>({ initial: 'A', transitions }));
    act(() => result.current.send('BACK'));
    expect(result.current.state).toBe('A');
  });

  it('can() reports whether an event is valid from current state', () => {
    const { result } = renderHook(() => useFsm<S, E>({ initial: 'A', transitions }));
    expect(result.current.can('NEXT')).toBe(true);
    expect(result.current.can('BACK')).toBe(false);
  });
});
