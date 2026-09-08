# PAGE_SPECS — 每頁面規格（Phase 4）

格式：Purpose / User / Entry / Action / State / Exit / Error / Empty / Loading / Success

## Home（`/`）
- **Purpose**：讓使用者從「此刻的心境需求」而非「神明清單」開始，降低選擇障礙。
- **User**：任何造訪者（無需登入）。
- **Entry**：App 首次載入、Bottom Nav／Sidebar「首頁」。
- **Action**：點選需求分類卡片 → 帶著篩選條件前往 Explore；或直接前往 Explore／My。
- **State**：純靜態內容，無非同步資料，無 Loading/Error 狀態。
- **Exit**：導向 `/explore?need=...` 或 `/explore`、`/my`。
- **Empty**：不適用（內容固定）。
- **Success**：頁面完整渲染六大需求分類。

## Explore（`/explore`）
- **Purpose**：瀏覽所有神明／寺廟，支援從 Home 帶入的需求篩選。
- **User**：任何造訪者。
- **Entry**：Home 卡片、Bottom Nav「探索」。
- **Action**：切換「神明探索／寺廟探索」Tab；點選卡片進入詳情。
- **State**：`useAsync` 管理 Loading/Error/Success；篩選為 URL query 驅動（可分享連結）。
- **Exit**：`/explore/deities/:id`、`/explore/temples/:id`。
- **Error**：顯示 ErrorState + Retry（呼叫 `getDeities`/`getTemples` 失敗時）。
- **Empty**：篩選後無符合神明時顯示 EmptyState，並提供「清除篩選」連結。
- **Loading**：LoadingState 骨架。

## Deity Space（`/explore/deities/:deityId`）
- **Purpose**：神明的入口頁，讓使用者選擇要進行拜拜／抽籤／點燈。
- **User**：任何造訪者。
- **Entry**：Explore 神明卡片、Worship/Fortune 完成後的返回連結。
- **Action**：三個入口按鈕分別導向拜拜／抽籤／點燈流程。
- **Error**：找不到神明 id 時顯示 ErrorState（無 Retry，因為是資料不存在而非網路錯誤）。
- **Loading**：LoadingState。
- **Success**：顯示神明介紹、掌管領域、三個行動入口，並附內容來源標籤與免責聲明。

## Temple Detail（`/explore/temples/:templeId`）
- 同上結構，顯示寺廟資訊與供奉神明清單，可跳轉至各神明空間。

## Worship（`/worship/:deityId`，全螢幕）
- **Purpose**：核心線上拜拜體驗（P0）。
- **User**：已選定神明的使用者。
- **Entry**：Deity Space「線上拜拜」按鈕。
- **State（FSM）**：IDLE → SELECT_DEITY → PREPARING → INCENSE → WORSHIP → PRAYER → COMPLETED（見 `src/features/worship/machine.ts`）。
- **Action**：依序點擊「開始拜拜」「點香」「鞠躬獻敬」，最後輸入願望並「獻上祈願」。
- **Exit**：右上角 ✕ 隨時可離開回到 Deity Space；COMPLETED 後可前往抽籤或我的紀錄。
- **Error**：神明資料載入失敗顯示 ErrorState + Retry；祈願送出失敗時按鈕維持可重試狀態（`submitting` guard 防止重複送出）。
- **Loading**：進入頁面時的 LoadingState；PREPARING 狀態本身即是設計過的敘事性 Loading。
- **Success**：COMPLETED 畫面確認願望已記錄。

## Fortune（`/fortune/:deityId`，全螢幕）
- **Purpose**：核心抽籤體驗＋AI 輔助白話解讀（P0）。
- **State（FSM）**：IDLE → PREPARING → PRAYER → SHAKING → DRAWING → REVEALING → RESULT → INTERPRETATION → COMPLETED。
- **Action**：（選填）輸入請示問題 → 「開始搖籤」→ 自動播放搖籤/飛籤/揭曉動畫（deterministic seed）→「查看白話解讀」→「完成」。
- **Error**：抽籤或解讀 API 失敗時目前僅在 Promise reject 時中斷（已知限制，見 CHANGELOG／Known Limitations，建議加入專屬 ErrorState 覆蓋層）。
- **Success**：COMPLETED 畫面提供「為此心願點一盞燈」與「查看我的紀錄」。

## Fortune Result（`/fortune/result/:ceremonyId`）
- **Purpose**：從「我的紀錄」回顧過去抽到的籤詩與解讀。
- **Loading/Error**：`useAsync` 管理；找不到紀錄時顯示明確錯誤訊息。

## Lantern List（`/lantern`）
- **Purpose**：檢視使用者已點的燈。
- **Empty**：尚未點燈時顯示 EmptyState + CTA。
- **Loading/Error**：標準 useAsync 三態。

## Lantern New（`/lantern/new/:deityId?`）
- **Purpose**：核心點燈體驗（P0）。
- **State（FSM）**：SELECT_TEMPLE → SELECT_LAMP → PRAYER → CONFIRM → LIGHTING → LIT → COMPLETED。
- **Action**：選寺廟 → 選燈種 → 寫心願 → 確認 → 點燈動畫 → 完成。
- **Error**：`createLamp` 失敗時目前中斷於 LIGHTING（已知限制，建議加入失敗回退到 CONFIRM 並提示重試）。

## Ritual List（`/ritual`）／Ritual Detail（`/ritual/:ritualId`）
- **Purpose**：祭改／傳統儀式的說明與預約入口（P1，敏感功能，非遊戲化）。
- **State（FSM）**：EXPLANATION → APPLICABILITY → FORM → CONFIRM → PROCESSING → COMPLETED → RECORD。
- **Action**：閱讀說明 → 勾選確認理解免責聲明 → 填寫聯絡資訊 → 確認送出。
- **Error**：`getRitualById` 找不到資料時顯示 ErrorState。
- **Success**：RECORD 畫面顯示「待寺廟確認」狀態，並記錄至信仰時光軸。

## My（`/my`）
- **Purpose**：信仰時光軸——目前唯一具備潛在護城河的功能（見 PROJECT_SPEC.md）。
- **Action**：切換「全部／我的祈願／我的籤／我的點燈／我的儀式」Tab（皆為同一份 `getHistory` 資料的前端篩選，刻意不做成獨立頁面以降低維護成本，見 CHANGELOG 的簡化決策）。
- **Empty**：完全沒有紀錄時提供「前往探索」CTA。
- **Error**：ErrorState + Retry。
