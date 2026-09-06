import type {
  Ceremony,
  Deity,
  FortuneInterpretation,
  FortuneSet,
  FortuneStick,
  HistoryEntry,
  Lamp,
  Prayer,
  Ritual,
  RitualBooking,
  Temple,
} from '@/domain/types';

/**
 * Service Layer 介面 — Mock 與未來 Real API 實作共用同一介面。
 * 元件永遠只呼叫這裡定義的函式，不直接接觸資料來源。見 ARCHITECTURE.md 第 3 節。
 */
export interface FaithService {
  getTemples(): Promise<Temple[]>;
  getTempleById(id: string): Promise<Temple | null>;
  getDeities(): Promise<Deity[]>;
  getDeityById(id: string): Promise<Deity | null>;
  getFortuneSet(deityId: string): Promise<FortuneSet>;
  drawFortune(deityId: string, seed?: number): Promise<FortuneStick>;
  interpretFortune(stick: FortuneStick): Promise<FortuneInterpretation>;
  getLamps(userId: string): Promise<Lamp[]>;
  createLamp(input: Omit<Lamp, 'id' | 'litAt' | 'expiresAt'>): Promise<Lamp>;
  getRituals(templeId?: string): Promise<Ritual[]>;
  getRitualById(id: string): Promise<Ritual | null>;
  createRitualBooking(
    input: Omit<RitualBooking, 'id' | 'status' | 'createdAt'>,
  ): Promise<RitualBooking>;
  createPrayer(input: Omit<Prayer, 'id' | 'createdAt'>): Promise<Prayer>;
  saveCeremony(input: Omit<Ceremony, 'id' | 'timestamp'>): Promise<Ceremony>;
  getHistory(userId: string): Promise<HistoryEntry[]>;
}
