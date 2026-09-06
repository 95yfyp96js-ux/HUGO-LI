# ARCHITECTURE

## 1. 技術決策紀錄（Decision Log）

環境確認：Node v22.22.2 / npm 10.9.7 / pnpm 10.33.0 / yarn 1.22.22 / git 2.43.0，專案原為空白（只有一行 README）。以下決策均為「可逆的技術選擇」，不涉及需要使用者決策的重大商業/法律/金流事項。

| 決策 | 選擇 | 原因 | 替代方案與拒絕理由 |
|---|---|---|---|
| 框架 | **Vite + React + TypeScript**（非 Next.js） | Phase 1 全為 Mock Data、無真實後端、無 SEO 迫切需求（P0 Journey 是互動體驗而非可索引內容頁）。Vite 開發迭代快、部署簡單，Service Layer 已抽象，未來若「神明探索/寺廟探索」需要 SSR/SEO，可平滑遷移到 Next.js 而不需重寫業務邏輯 | Next.js：功能過剩，且會引入伺服器渲染複雜度，此階段無法產生對應價值。純 CRA：已停止維護 |
| 套件管理 | pnpm | 已安裝於環境、安裝快、磁碟效率高 | npm/yarn 皆可，無強烈理由不選 pnpm |
| 路由 | react-router v6 | 業界標準、支援 nested routes 對應 IA 分層 | — |
| 樣式 | Tailwind CSS + CSS Variables（Design Tokens） | 快速實現一致的 Design Token 系統，CSS Variables 讓主題（如未來夜間模式）可集中控制 | CSS-in-JS：增加 runtime 成本，非必要 |
| 狀態機 | 自製輕量 FSM（`useReducer` + typed transition table） | Phase 6 明確要求「UI 動畫與資料狀態不可脫鉤」，手刻 FSM 可精準控制每個 transition 與對應的動畫/音效 side-effect，且無額外學習成本 | XState：功能強大但對此規模是過度設計，且團隊（未來維護者）需額外學習曲線 |
| 動效 | Framer Motion（`motion`）+ 少量 CSS keyframes | React 生態成熟、宣告式、支援手勢與 layout animation，符合 Motion System 的 duration/easing token 需求 | 原生 CSS only：可行但重複造輪子；重量級粒子/WebGL 函式庫：與設計原則（禁止過度 Glow/Particle）衝突，且非必要 |
| 音效 | Web Audio API 自製 `AudioManager`（合成音，非外部音檔） | 避免真實宗教音檔的授權/文化敏感問題，且完全自主可控、無網路依賴 | 外部音效素材庫：授權與文化適當性風險 |
| 測試 | Vitest + React Testing Library（單元）、Playwright（響應式/視覺驗證，環境已預裝） | 與 Vite 原生整合，Playwright 已預裝於此環境 | — |
| Lint/Format | ESLint + Prettier + TypeScript strict mode | 標準工具鏈 | — |

**這些選擇未來如需調整（例如真的要接真實後端而需要 SSR），Service Layer 的抽象設計已預留遷移路徑，不需重寫 UI 邏輯。**

## 2. Domain Model

```
User          — id, displayName, createdAt (mock, 無真實驗證)
Temple        — id, name, city, deities[], description, verified(boolean), imageUrl
Deity         — id, name, title, domain(掌管領域), templeIds[], description, imageUrl
FortuneSet    — id, deityId, sticks: FortuneStick[]
FortuneStick  — id, number, level(大吉/中吉/小吉/平/凶...), poem, vernacular(白話), categories
Prayer        — id, userId, deityId, templeId?, wish(text), createdAt, ceremonyId
Lamp          — id, userId, deityId, templeId, type(光明燈/平安燈/財神燈...), wish, litAt, expiresAt
Ritual        — id, templeId, name, description, applicabilityNotes, disclaimer
RitualBooking — id, userId, ritualId, status(SUBMITTED/CONFIRMED/COMPLETED), createdAt
Ceremony      — id, userId, type(WORSHIP/FORTUNE/LAMP/RITUAL), refId, timestamp, summary
HistoryEntry  — 由 Ceremony 聚合而成的時間軸項目（唯讀 view model）
ContentSource — enum: MOCK_DATA | AI_GENERATED | TEMPLE_VERIFIED（見 Phase 10 安全機制）
```

未來擴充（P2，現在只留介面不實作）：`Order`, `Payment`, `Membership`, `Notification`。

## 3. Service / Repository Layer

原則：**Frontend 元件永遠不直接 import mock json**，一律透過 `src/services/*` 的函式呼叫。Mock 實作與未來 Real API 實作共用同一介面（`src/services/types.ts` 定義的 interface），替換時只需替換 implementation，不動 UI。

```
getTemples(): Promise<Temple[]>
getTempleById(id): Promise<Temple | null>
getDeities(): Promise<Deity[]>
getDeityById(id): Promise<Deity | null>
getFortuneSet(deityId): Promise<FortuneSet>
drawFortune(deityId, seed?): Promise<FortuneStick>   // deterministic when seed 提供
interpretFortune(stick): Promise<{ vernacular: string; source: 'AI_GENERATED' }>
getLamps(userId): Promise<Lamp[]>
createLamp(input): Promise<Lamp>
getRituals(templeId?): Promise<Ritual[]>
createRitualBooking(input): Promise<RitualBooking>
createPrayer(input): Promise<Prayer>
saveCeremony(input): Promise<Ceremony>
getHistory(userId): Promise<HistoryEntry[]>
```

所有 mock service 函式模擬真實網路延遲（100–400ms 隨機/固定，測試模式可關閉）與可能的錯誤（用於 QA 的錯誤狀態測試），詳見 `src/services/mock/network.ts`。

## 4. Information Architecture / Route Map

七大分類（對應 Phase 4 要求）：

```
/                      Home
/explore                Explore（神明探索 + 寺廟探索 tabs）
/explore/deities/:id    神明空間（Deity Space）— 拜拜/祈願/抽籤入口
/explore/temples/:id    寺廟詳情
/worship/:deityId       線上拜拜 FSM 全螢幕體驗
/fortune/:deityId       抽籤 FSM 全螢幕體驗
/fortune/result/:id     籤詩結果 + AI 解讀（可從 History 重新查看）
/lantern                點燈列表/入口
/lantern/new/:deityId?  點燈 FSM
/ritual                 祭改／傳統儀式入口列表
/ritual/:id             儀式說明/預約流程
/my                     我的（總覽：紀錄/祈願/籤/點燈/儀式 tabs）
/my/history             信仰時間軸
```

- Desktop（≥1024px）：左側 Sidebar（Home/Explore/Lantern/Ritual/My）+ 頂部 Header（搜尋、使用者狀態）
- Mobile（<768px）：Bottom Navigation（Home/Explore/Lantern/Ritual/My，5 tabs）
- 768–1024px：Bottom Navigation 沿用（避免中間態的第三套佈局，降低維護成本——此為刻意的簡化決策）

每個頁面的 Purpose/User/Entry/Action/State/Exit/Error/Empty/Loading/Success 定義在 `docs/PAGE_SPECS.md`（實作階段同步建立）。

## 5. State Machine 總覽

四個核心 FSM，皆實作於 `src/features/*/machine.ts`，共用 `src/lib/fsm.ts` 的 `createFsm` utility：

- **WorshipMachine**: IDLE → SELECT_DEITY → PREPARING → INCENSE → WORSHIP → PRAYER → COMPLETED
- **FortuneMachine**: IDLE → PREPARING → PRAYER → SHAKING → DRAWING → REVEALING → RESULT → INTERPRETATION → COMPLETED
- **LanternMachine**: SELECT_TEMPLE → SELECT_LAMP → PRAYER → CONFIRM → LIGHTING → LIT → COMPLETED
- **RitualMachine**: SELECT_TEMPLE → SELECT_RITUAL → EXPLANATION → APPLICABILITY → FORM → CONFIRM → PROCESSING → COMPLETED → RECORD

所有 FSM 的隨機性（如抽籤結果）透過 `src/lib/deterministicRandom.ts` 的 seeded PRNG 提供，確保同一 seed 下動畫節奏與資料結果一致，也讓測試可重現。

## 6. 專案結構

```
src/
  app/            # App shell, router, providers
  components/     # 共用 Design System 元件（原子/分子）
  features/
    worship/      # FSM + UI + assets
    fortune/
    lantern/
    ritual/
    explore/
    my/
  domain/         # TypeScript types（Domain Model）
  services/
    types.ts
    mock/         # mock data + mock service 實作
  lib/            # fsm.ts, deterministicRandom.ts, audioManager.ts, motion tokens
  styles/         # tokens.css, tailwind config
docs/
  PAGE_SPECS.md
```
