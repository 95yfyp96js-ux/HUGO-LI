# SECURITY — 宗教內容安全與一般安全審查

## Phase 10：宗教內容安全機制（已實作）

### 機制設計
- `ContentSource` 型別（`src/domain/types.ts`）強制每一筆宗教相關內容標示來源：`MOCK_DATA`（原型示意）／`AI_GENERATED`（AI 輔助生成）／`TEMPLE_VERIFIED`（寺廟驗證，目前系統中尚無任何內容屬於此類）。
- `SourceBadge` 元件在神明介紹、寺廟介紹、AI 解籤結果旁強制顯示來源標籤，使用者不會誤把 Mock/AI 內容當成官方宗教內容。
- `Disclaimer` 元件在 AI 解讀、祭改說明頁強制顯示免責文字。
- AI 解讀函式（`src/services/mock/index.ts` 的 `generateInterpretation`）刻意使用「提醒／參考」語氣，不使用「神明指示」「準確」「保證」等字眼，且回傳值固定附帶 disclaimer 欄位。

### 已遵守的紅線（見 PROJECT_SPEC.md 第 2 節）
- 不宣稱 AI 生成內容代表神明旨意
- 不虛構「準確率」或「靈驗度」
- 祭改流程（`src/features/ritual/`）全程無遊戲化動畫，`APPLICABILITY` 步驟強制使用者勾選「我了解不保證效果」才能繼續預約
- 所有 Mock 內容明確標示「示意內容，非真實寺廟授權」

### 尚未實作、正式上線前必須完成
- 真實內容需求寺廟／宗教專業人士審核流程（目前系統中沒有任何內容具備審核紀錄或審核者身分）
- 內容變更的版本紀錄與可追溯性（目前 Mock 內容為靜態常數，無編輯歷史）

---

## Phase 12：一般安全審查

即使目前全為 Mock，仍先行檢查架構是否會製造「未來難以修正」的安全債務。

| 項目 | 現況 | 評估與未來要求 |
|---|---|---|
| Authentication | 無真實登入，`MOCK_USER_ID` 為寫死的單一使用者 | 上線前必須導入真實身分驗證（OAuth/簡訊驗證等），且 Service Layer 介面已將 `userId` 作為顯式參數傳遞，未來接入時不需重構呼叫端 |
| Authorization | 無多使用者權限模型 | 所有 mutation（createPrayer/createLamp/createRitualBooking）目前只接受呼叫端傳入的 userId，這在真實後端必須改為從已驗證的 session 派生，前端絕不可信任自行傳入的 userId——**這是目前架構中唯一需要在接入真實後端時「破壞性修改」的部分，已記錄以提醒未來實作者** |
| Input Validation | 前端有基本的必填/長度限制（maxLength），無伺服器端驗證 | Mock 無伺服器，真實後端必須在 API 層重新驗證，不可信任前端驗證 |
| XSS | 所有使用者輸入（祈願文字、儀式備註）僅以 React 純文字節點渲染，未使用 `dangerouslySetInnerHTML`，React 預設會 escape | 維持此原則，未來若支援 Markdown/富文本需另外導入淨化（sanitization）機制 |
| CSRF | 不適用（無真實 session/cookie 後端） | 真實後端使用 cookie-based session 時需加入 CSRF token |
| Rate Limit | 無（Mock 無網路 API） | 真實後端的抽籤/預約端點應加入 rate limit，避免濫用（例如洗版式抽籤） |
| 個資 | 目前僅 localStorage 存放使用者自行輸入的願望文字與聯絡資訊（祭改預約表單），未上傳任何伺服器 | 真實系統中聯絡電話等屬個資，需納入個資保護法遵循範圍與最小化蒐集原則 |
| Payment Security | 未接金流（Phase 1 明確排除） | 未來若接金流，金流資訊絕不可自建，需使用第三方合規金流服務 |
| API Security | 無真實 API | 真實 API 需要 HTTPS、輸入驗證、輸出編碼、適當的錯誤訊息（不洩漏內部細節） |
| Logging / Audit Trail | 無 | 真實系統中，點燈/儀式預約等涉及金錢或承諾的操作應有審計紀錄，便於爭議處理 |
| AI 金鑰安全 | 目前 AI 解讀為前端本地模擬生成，未呼叫真實 LLM API | **重要提醒**：未來若改為呼叫真實 LLM API，金鑰絕不可放在前端程式碼或環境變數中直接暴露給瀏覽器，必須透過後端代理呼叫 |

### 結論
目前架構沒有為了 Demo 而挖出「未來無法擴展的安全洞」——最關鍵的一點是 `userId` 目前由前端顯式傳遞，這在真實系統中必須改為從伺服器端 session 派生，已在上表中明確標注，避免未來實作者誤以為現有模式可以直接接上真實後端。
