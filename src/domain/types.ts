/**
 * Domain Model — 見 ARCHITECTURE.md 第 2 節。
 * ContentSource 標示每筆內容的來源，是 Phase 10 宗教內容安全機制的基礎（禁止把 AI 生成內容冒充宗教傳統）。
 */
export type ContentSource = 'MOCK_DATA' | 'AI_GENERATED' | 'TEMPLE_VERIFIED';

export interface Temple {
  id: string;
  name: string;
  city: string;
  address: string;
  deityIds: string[];
  description: string;
  contentSource: ContentSource;
}

export type DeityDomain =
  | '學業事業'
  | '姻緣感情'
  | '平安健康'
  | '財運'
  | '陰陽調和'
  | '合境平安';

export interface Deity {
  id: string;
  name: string;
  title: string;
  domain: DeityDomain[];
  templeIds: string[];
  description: string;
  contentSource: ContentSource;
}

export type FortuneLevel = '上上籤' | '上籤' | '中籤' | '中平籤' | '下籤' | '下下籤';

export interface FortuneStick {
  id: string;
  number: number;
  level: FortuneLevel;
  poem: string;
  categories: DeityDomain[];
}

export interface FortuneSet {
  deityId: string;
  sticks: FortuneStick[];
}

export interface FortuneInterpretation {
  vernacular: string;
  guidance: string;
  contentSource: 'AI_GENERATED';
  disclaimer: string;
}

export interface Prayer {
  id: string;
  userId: string;
  deityId: string;
  templeId?: string;
  wish: string;
  createdAt: string;
}

export type LampType = '光明燈' | '平安燈' | '財神燈' | '文昌燈';

export interface Lamp {
  id: string;
  userId: string;
  deityId: string;
  templeId: string;
  type: LampType;
  wish: string;
  litAt: string;
  expiresAt: string;
}

export interface Ritual {
  id: string;
  templeId: string;
  name: string;
  description: string;
  applicabilityNotes: string;
  disclaimer: string;
  contentSource: ContentSource;
}

export type RitualBookingStatus = 'SUBMITTED' | 'CONFIRMED' | 'COMPLETED';

export interface RitualBooking {
  id: string;
  userId: string;
  ritualId: string;
  templeId: string;
  contactName: string;
  contactPhone: string;
  note?: string;
  status: RitualBookingStatus;
  createdAt: string;
}

export type CeremonyType = 'WORSHIP' | 'FORTUNE' | 'LAMP' | 'RITUAL';

export interface Ceremony {
  id: string;
  userId: string;
  type: CeremonyType;
  refId: string;
  deityId?: string;
  templeId?: string;
  summary: string;
  timestamp: string;
}

export interface HistoryEntry extends Ceremony {
  deityName?: string;
  templeName?: string;
}
