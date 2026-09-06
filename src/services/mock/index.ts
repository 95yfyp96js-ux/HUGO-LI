import type {
  Ceremony,
  Deity,
  FortuneInterpretation,
  FortuneStick,
  HistoryEntry,
  Lamp,
  Prayer,
  Ritual,
  RitualBooking,
  Temple,
} from '@/domain/types';
import type { FaithService } from '@/services/types';
import { MOCK_DEITIES, MOCK_FORTUNE_SETS, MOCK_RITUALS, MOCK_TEMPLES } from './data';
import { mockDelay, maybeThrowMockFailure } from './network';
import { appendItem, readList } from './storage';
import { pickDeterministic, seedFromString } from '@/lib/deterministicRandom';

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * AI 輔助解讀的 Mock 實作。
 * 重要：這裡刻意不宣稱「準確」、不使用「神明指示」等字眼，且固定附上 disclaimer。
 * 真實產品中，這一步應改為呼叫後端代理的 LLM API（金鑰絕不可放前端），並保留人工審核機制。
 */
function generateInterpretation(stick: FortuneStick): FortuneInterpretation {
  const guidanceByLevel: Record<string, string> = {
    上上籤: '整體氛圍偏向順遂，但仍建議保持謹慎，勿因順利而鬆懈準備。',
    上籤: '大致順利，若遇到猶豫的決定，此時是可以嘗試往前推進的時機。',
    中籤: '情勢平穩，關鍵在於耐心與時機，不宜躁進，也不必過度擔憂。',
    中平籤: '好壞未定，建議多觀察、多蒐集資訊後再做決定，避免倉促行動。',
    下籤: '此刻可能面臨阻礙，建議謹慎行事，並考慮尋求周遭信任的人多方討論。',
    下下籤: '提醒你近期宜謹慎保守，遇到重大決定時，建議放慢腳步、多方確認。',
  };

  return {
    vernacular: `這支籤的意象是「${stick.poem}」。整體語氣${
      stick.level.includes('上') ? '偏向正向' : stick.level.includes('下') ? '提醒謹慎' : '中性平穩'
    }，反映的是一種心境上的提醒，而非對具體事件的預測。`,
    guidance: guidanceByLevel[stick.level] ?? '建議以平常心看待，籤詩僅供參考。',
    contentSource: 'AI_GENERATED',
    disclaimer:
      '此解讀由 AI 輔助生成白話翻譯，僅供參考，不代表官方宗教解釋，也不構成任何人生重大決定的依據。',
  };
}

export const mockFaithService: FaithService = {
  async getTemples(): Promise<Temple[]> {
    await mockDelay();
    maybeThrowMockFailure();
    return MOCK_TEMPLES;
  },

  async getTempleById(id: string): Promise<Temple | null> {
    await mockDelay();
    maybeThrowMockFailure();
    return MOCK_TEMPLES.find((t) => t.id === id) ?? null;
  },

  async getDeities(): Promise<Deity[]> {
    await mockDelay();
    maybeThrowMockFailure();
    return MOCK_DEITIES;
  },

  async getDeityById(id: string): Promise<Deity | null> {
    await mockDelay();
    maybeThrowMockFailure();
    return MOCK_DEITIES.find((d) => d.id === id) ?? null;
  },

  async getFortuneSet(deityId: string) {
    await mockDelay();
    maybeThrowMockFailure();
    const set = MOCK_FORTUNE_SETS[deityId];
    if (!set) throw new Error(`找不到神明 ${deityId} 的籤詩組`);
    return set;
  },

  async drawFortune(deityId: string, seed?: number): Promise<FortuneStick> {
    await mockDelay(200, 500);
    maybeThrowMockFailure();
    const set = MOCK_FORTUNE_SETS[deityId];
    if (!set) throw new Error(`找不到神明 ${deityId} 的籤詩組`);
    const resolvedSeed = seed ?? seedFromString(`${deityId}-${Date.now()}`);
    return pickDeterministic(set.sticks, resolvedSeed);
  },

  async interpretFortune(stick: FortuneStick): Promise<FortuneInterpretation> {
    await mockDelay(300, 700);
    maybeThrowMockFailure();
    return generateInterpretation(stick);
  },

  async getLamps(userId: string): Promise<Lamp[]> {
    await mockDelay();
    return readList<Lamp>('lamps').filter((l) => l.userId === userId);
  },

  async createLamp(input): Promise<Lamp> {
    await mockDelay(200, 500);
    maybeThrowMockFailure();
    const now = new Date();
    const expires = new Date(now);
    expires.setFullYear(expires.getFullYear() + 1);
    const lamp: Lamp = {
      ...input,
      id: uid('lamp'),
      litAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    };
    appendItem('lamps', lamp);
    return lamp;
  },

  async getRituals(templeId?: string): Promise<Ritual[]> {
    await mockDelay();
    maybeThrowMockFailure();
    return templeId ? MOCK_RITUALS.filter((r) => r.templeId === templeId) : MOCK_RITUALS;
  },

  async getRitualById(id: string): Promise<Ritual | null> {
    await mockDelay();
    maybeThrowMockFailure();
    return MOCK_RITUALS.find((r) => r.id === id) ?? null;
  },

  async createRitualBooking(input): Promise<RitualBooking> {
    await mockDelay(200, 500);
    maybeThrowMockFailure();
    const booking: RitualBooking = {
      ...input,
      id: uid('booking'),
      status: 'SUBMITTED',
      createdAt: new Date().toISOString(),
    };
    appendItem('ritualBookings', booking);
    return booking;
  },

  async createPrayer(input): Promise<Prayer> {
    await mockDelay(150, 350);
    maybeThrowMockFailure();
    const prayer: Prayer = {
      ...input,
      id: uid('prayer'),
      createdAt: new Date().toISOString(),
    };
    appendItem('prayers', prayer);
    return prayer;
  },

  async saveCeremony(input): Promise<Ceremony> {
    await mockDelay(100, 250);
    const ceremony: Ceremony = {
      ...input,
      id: uid('ceremony'),
      timestamp: new Date().toISOString(),
    };
    appendItem('ceremonies', ceremony);
    return ceremony;
  },

  async getHistory(userId: string): Promise<HistoryEntry[]> {
    await mockDelay();
    const ceremonies = readList<Ceremony>('ceremonies').filter((c) => c.userId === userId);
    const entries: HistoryEntry[] = ceremonies.map((c) => ({
      ...c,
      deityName: c.deityId ? MOCK_DEITIES.find((d) => d.id === c.deityId)?.name : undefined,
      templeName: c.templeId ? MOCK_TEMPLES.find((t) => t.id === c.templeId)?.name : undefined,
    }));
    return entries.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  },
};
