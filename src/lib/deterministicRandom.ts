/**
 * Seeded PRNG（mulberry32）— 讓抽籤動畫節奏與最終資料結果可重現、可測試。
 * Phase 6 要求：「不能讓 UI 動畫與資料狀態脫鉤」。
 */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

export function pickDeterministic<T>(items: T[], seed: number): T {
  const random = mulberry32(seed);
  const index = Math.floor(random() * items.length);
  return items[Math.min(index, items.length - 1)];
}
