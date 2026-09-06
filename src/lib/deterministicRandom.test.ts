import { describe, expect, it } from 'vitest';
import { mulberry32, pickDeterministic, seedFromString } from './deterministicRandom';

describe('deterministicRandom', () => {
  it('mulberry32 produces the same sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect(a()).toBe(b());
    expect(a()).toBe(b());
  });

  it('pickDeterministic returns the same item for the same seed', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(pickDeterministic(items, 7)).toBe(pickDeterministic(items, 7));
  });

  it('seedFromString is stable for the same input', () => {
    expect(seedFromString('deity-mazu')).toBe(seedFromString('deity-mazu'));
  });
});
