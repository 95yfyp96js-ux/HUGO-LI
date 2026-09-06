# 台灣數位信仰平台（Taiwan Digital Faith Platform）

「Digital Faith Infrastructure」的第一階段原型：把台灣傳統信仰中的部分線下服務，以現代數位產品重新設計。

**目前狀態：Phase 1 產品假設驗證原型。全部資料為 Mock，無真實金流、無真實會員系統、無真實寺廟合作。**

## 文件索引

- [PROJECT_SPEC.md](./PROJECT_SPEC.md) — 第一性原理分析、MVP Scope（P0/P1/P2）
- [COMPETITIVE_ATTACK_REPORT.md](./COMPETITIVE_ATTACK_REPORT.md) — 競品攻擊與商業風險
- [ARCHITECTURE.md](./ARCHITECTURE.md) — 技術決策、Domain Model、IA、State Machine
- [CHANGELOG.md](./CHANGELOG.md) — 重大變更紀錄
- [SECURITY.md](./SECURITY.md) — 安全審查與宗教內容安全規則
- [docs/PAGE_SPECS.md](./docs/PAGE_SPECS.md) — 每頁面 Purpose/State 定義

## 快速開始

```bash
pnpm install
pnpm dev        # 開發伺服器
pnpm lint       # ESLint
pnpm typecheck  # TypeScript
pnpm test       # Vitest
pnpm build      # 正式建置
```

## 核心 Journey（P0）

首頁 → 神明探索 → 神明空間 → 線上拜拜 → 祈願 → 抽籤 → 籤詩揭露 → AI 輔助解讀 → 儲存結果 → 點燈 → 我的紀錄

## 技術棧

Vite + React + TypeScript + Tailwind CSS + React Router + Framer Motion + 自製 FSM + Web Audio（合成音效）。詳見 ARCHITECTURE.md。
