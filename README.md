# Small Lending OS v1.0

A lending operations system: the complete digital workflow for a private
small-loan book, from enquiry to settlement.

```
Customer → Application → Risk → Limit → Pricing → Approval
        → Loan → Disbursement → Servicing → Payment
        → Overdue → Collection → Renewal / Extension → Settlement → Portfolio
```

This is not a loan CRUD app. The lifecycle above is the system: risk scoring,
limit setting, pricing, interest, schedules, payment allocation, delinquency,
collections and the money ledger are each modelled explicitly, and the UI
performs no financial calculation of its own.

## 本機啟動方式

> **這是訓練用環境。** 資料全部跑在你自己的電腦上，是練習用的假資料，
> 不是正式核貸，不具法律效力，也不可用於對外報價或實際放款。

安裝與建立練習資料（只需做一次）：

```bash
npm install
cd server && npx prisma migrate deploy && npm run seed && cd ..
```

開兩個終端機分別啟動：

```bash
npm run dev:server     # 後端 API，連接埠 4000
npm run dev:web        # 前端畫面，連接埠 5173
```

啟動後打開 <http://localhost:5173>。畫面最上方會固定顯示訓練用橫幅。

### 訓練用帳號

以下帳號**僅供本機訓練**，密碼一律 `Password123!`：

| 帳號 | 角色 | 可以做什麼 |
|---|---|---|
| `officer@lending.local` | 業務 | 建客戶、建申請、送審 |
| `manager@lending.local` | 主管 | 核准（可覆寫金額／天數／利率）、建放款、撥款 |
| `collector@lending.local` | 催收 | 看逾期案件、記錄催收 |
| `auditor@lending.local` | 稽核 | 唯讀，看稽核軌跡 |

登入不同帳號可以看到權限如何改變畫面上可用的功能。

### 練習：新增一筆 7 天日息件

1. 用 `officer@lending.local` 登入。
2. **客戶 → 新增客戶**，隨便填一位客戶並存檔。
3. **放款申請 → 新增申請**：
   - 產品選 **短天期單利**（0.1%／日）
   - 選好產品後，下方會顯示可借金額 `10000.00 ~ 200000.00` 與可借天數 `7 ~ 30 天`
   - 申請金額填 `100000`，申請天數填 `7`
   - 金額或天數超出範圍時，欄位下方會出現紅字，且「建立申請」按鈕會變成不可按
4. 建立後進入申請頁，按 **送出申請（執行風控）**，系統會自動跑風控、額度與定價。
5. 改用 `manager@lending.local` 登入，回到同一筆申請，按 **核准**。
   核准視窗可以覆寫金額、天數、利率；留白就照定價結果走。
6. 按 **建立放款**，再到放款頁按 **撥款**。

預期會看到：

- 還款排程只有 **1 期**（到期一次還清）
- 到期日是撥款日 **+7 天**，不是 +7 個月
- 利息 **700**（100,000 × 0.1% × 7 天，單利）
- 應還總額 **100,700**
- 合約快照顯示「天數 7 天」，之後就算改產品利率也不會變動

用 `manager@lending.local` 到 **收款 → 新增收款**，對這筆放款收 `100700`，
放款狀態會變成已結清。

## Commands

| Command | What it does |
|---|---|
| `npm test` | 116 unit + integration + API tests |
| `npm run test:e2e` | 14 Playwright tests, desktop + mobile viewports |
| `npm run typecheck` | Type-checks both workspaces |
| `npm run lint` | Lints both workspaces |
| `npm run build` | Builds API and UI |
| `npm run seed` | Rebuilds the demo portfolio |
| `npm run reconcile --workspace server` | Replays every loan's ledger and checks it against stored balances |
| `npm run export:snapshot --workspace server` | Records every read API response (needs the API running) |
| `npm run build:preview --workspace web` | Builds a single-file, read-only static preview from that snapshot |

### Static preview

`build:preview` produces `web/dist-preview/preview.html`: the real UI bundled
with recorded API responses instead of a server, for sharing where the stack
cannot be run. The figures in it are genuine engine output frozen at export
time; every write path is refused rather than faked, and the page says so.
Regenerate it with `npm run seed`, start the API, then `export:snapshot`
followed by `build:preview`.

## Layout

```
server/    Express API, domain engines, Prisma schema, tests
web/       React UI (desktop + mobile), Playwright E2E
docs/      Architecture, domain, engines, API, database, security, testing, decision log
```

## Principles this build holds to

**The UI never calculates money.** Every amount, rate, schedule and KPI comes
from a backend engine. `web/src/lib/format.ts` formats; it does not compute.

**Balances are a projection, not the truth.** The append-only `MoneyEvent`
ledger is the source of truth. Stored balances exist for speed and must
always be reproducible from the ledger — `npm run reconcile` proves it across
the whole book.

**History is appended, never rewritten.** Reversing a payment writes a
`PAYMENT_REVERSAL`. Renewing a loan creates a new loan and leaves the old
one's history untouched. Repricing a product creates a new version rather
than editing live contracts. Loan terms are frozen in an immutable
`LoanSnapshot` at creation.

**Status changes go through state machines.** No code anywhere assigns
`loan.status = "OVERDUE"`.

**Time is injected.** Nothing in the domain calls `new Date()`; a `Clock` is
passed in, which is why delinquency can be tested deterministically and the
seed can age a portfolio through real history.

**Permissions are enforced on the server.** The UI hides what a user cannot
do as a courtesy; the API rejects it regardless.

Start with `docs/architecture.md`, then `docs/decision-log.md` for why things
are the way they are — including the trade-offs that still need attention
before this handles real money.
