# CHANGELOG

## [Unreleased]

### 2026-09-06 — Phase 0-1 專案初始化

- 確認為全新空白專案（Node 22.22.2 / pnpm 10.33.0 / git 2.43.0）
- 完成第一性原理產品分析（PROJECT_SPEC.md）與競品攻擊報告（COMPETITIVE_ATTACK_REPORT.md）
- 決定技術棧：Vite + React + TypeScript + Tailwind + React Router + Framer Motion + 自製 FSM（理由見 ARCHITECTURE.md 決策紀錄）
- 建立 MVP Scope：P0 為完整核心 Journey（首頁→神明探索→拜拜→抽籤→點燈→我的紀錄）

### 2026-09-06 — Phase 3-15 完整 MVP 原型

- **IA/路由**：建立七大分類（Home/Explore/Worship/Fortune/Lantern/Ritual/My）與完整 Route Map（見 ARCHITECTURE.md）
- **Design System**：Tailwind tokens（色彩/字體/圓角/陰影/motion）、Button/Card/Tabs/BottomSheet/Toast/StateViews（Loading/Empty/Error）/SourceBadge/Disclaimer
- **Domain Model + Mock Service Layer**：`src/domain/types.ts`、`src/services/*`，前端一律透過 `FaithService` 介面存取資料，未來替換真實後端只需替換 `src/services/index.ts` 的實作
- **四個核心 State Machine**（自製 `useFsm`）：WorshipMachine／FortuneMachine／LanternMachine／RitualMachine，皆對應需求指定的狀態流程
- **完整核心 Journey 落地**：首頁→探索神明→神明空間→線上拜拜→祈願→抽籤→籤詩揭露→AI輔助解讀→儲存→點燈→我的紀錄，端對端 Playwright 測試零錯誤通過
- **祭改入口**：非遊戲化、強制使用者確認免責聲明才能預約
- **Motion System**：`src/lib/motionTokens.ts` 統一 duration/easing
- **Audio Manager**：Web Audio 合成音效（非外部音檔），支援開關/音量/失敗降級
- **宗教內容安全機制**：`ContentSource` 型別 + `SourceBadge` + `Disclaimer`，全站宗教內容皆標示來源（見 SECURITY.md）
- **簡化決策**：「我的祈願/我的籤/我的點燈/我的儀式」實作為 `/my` 單頁的 Tab 篩選，而非四個獨立頁面，因為底層資料皆源自同一份 `HistoryEntry`，拆成獨立頁面只會增加維護成本而不增加使用者價值（Phase 14「刪除→簡化→標準化」原則）
- **QA**：Vitest 9 tests 全過；Playwright 端對端跑完整 Journey 並涵蓋 320/390/1024/1440px；發現並修正 Fortune/Lantern/Ritual 缺少錯誤處理的問題（見 QA_REPORT.md）
- **Build**：lint/typecheck/test/build 全數通過（見下方指令紀錄）
- **Red Team 結論**：籤詩內容為虛構、非真實籤詩系統，已標記為上線前最優先要解決的文化真實性風險；祭改功能標記為法律風險最高、應優先做低成本驗證而非繼續開發（見 RED_TEAM_REPORT.md）

### 2026-09-07 — 視覺方向重做：夜間宮廟

目標感覺改為「一座夜裡的宮廟，只有香爐和燭火發光，其他都在暗處」。完整規則見 [DESIGN.md](./DESIGN.md)。

- **調色盤全面替換**：原本的暖白日間色系（surface/ink/jade/gold）改為 void／ash／ember／flame／paper 五角色，並移除淺色模式——這個產品只有一種光線狀態：夜
- **新增 `<Light>` 光源元件**：光只能透過 `CeremonyScreen`／`PageScreen` 的單一 `light` prop 取得，讓「一個畫面只有一個光源」由架構保證而非靠自律；光的衰減刻意加快，避免畫面變成一片棕霧
- **構圖分流**：儀式畫面（拜拜／抽籤／點燈）置中對稱；瀏覽／管理畫面（首頁／探索／紀錄／祭改）靠左不對稱。點燈流程因此從一般頁面改為全螢幕儀式畫面
- **新增 `<Paper>` 元件**：暖白紙質只用於籤紙與祈願卡，紙上文字為墨色（全站唯一深色文字）；AI 解讀刻意不做成紙，因為它是旁人的說明而非神明給的那張籤
- **按鈕移除外框**：改為拉開字距的文字加一條細線——描邊矩形在只有一盞光的畫面裡會變成第二個光源
- **移除所有裝飾性符號**：導覽列的 ⌂ ☯ ☼ 卐 ☰ 圖示全部拿掉，改為純文字。這些符號分屬不同宗教／文化體系，混用只是「看起來很東方」；其中 卐 具實際宗教意義且極易被誤讀，不適合當導覽圖示
- **ESLint 設定**：`no-irregular-whitespace` 加上 `skipJSXText`，因為介面文案刻意使用全形空格（U+3000）作為中文排版分隔
