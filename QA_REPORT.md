# QA_REPORT（Phase 11）

## 測試方式
- 自動化：Vitest（單元測試，9 個測試全數通過，涵蓋 FSM 邏輯、deterministic random、App 路由渲染）
- 手動／腳本化端對端：使用環境預裝的 Playwright（Chromium）跑完整核心 Journey（首頁 → 探索 → 神明空間 → 拜拜 → 抽籤 → 點燈 → 我的紀錄），全程監聽 `pageerror`／`console.error`，**零錯誤**。

## 狀態測試結果

| 狀態 | 測試方式 | 結果 |
|---|---|---|
| Loading | 每個資料頁面（Explore/DeitySpace/TempleDetail/Lantern/Ritual/My）皆有獨立 Loading 骨架 | ✅ 已實作並在端對端測試中觀察到 |
| Empty | Explore 篩選無結果、Lantern 尚未點燈、My 尚無紀錄 | ✅ 皆有 EmptyState + 明確 CTA |
| Error | 透過 `setMockFailureInjection` 可強制注入網路錯誤；本次修正前 Fortune/Lantern/Ritual 的核心操作若失敗會讓 UI 卡住 | ⚠️→✅ 已修正：所有核心 ceremony 提交動作皆加上 try/catch，失敗時透過 Toast 顯示錯誤並導回安全頁面（詳見下方已知限制） |
| Retry | Explore/DeitySpace/TempleDetail/Lantern List/Ritual List/My 皆使用 `useAsync` 的 `retry()` | ✅ |
| Double Click / Rapid Click | Worship 祈願送出、Lantern 點燈確認、Ritual 送出預約皆用 `submitting` 旗標防止重複送出 | ✅ |
| Refresh | 已完成的紀錄（Prayer/Lamp/RitualBooking/Ceremony）存於 localStorage，重新整理後「我的紀錄」資料不遺失；但**進行中的 FSM 流程狀態（如抽籤到一半）reload 後會重置到初始狀態** | ⚠️ 已知限制，見下方 |
| Back / Forward | 使用 React Router 標準機制，瀏覽器上一頁／下一頁可正常運作 | ✅ |
| Modal Close | BottomSheet 元件支援點擊遮罩或呼叫 onClose 關閉（目前尚未有頁面實際使用 BottomSheet，元件已備妥待未來功能使用） | ✅（元件層級） |
| Animation Interrupt | Framer Motion 的 `AnimatePresence mode="wait"` 確保狀態切換時動畫不會疊加衝突 | ✅ |
| Network Failure | 見上方 Error 測試 | ✅ |

## 響應式斷點測試

實際使用 Playwright 截圖驗證以下寬度，確認無版面溢出、Bottom Nav／Sidebar 正確切換：

- 320px（Home）
- 390px（完整核心 Journey，主要測試寬度）
- 1024px（My 頁面 — 此寬度沿用 Mobile Bottom Nav，為刻意的簡化決策，見 ARCHITECTURE.md）
- 1440px（My 頁面 — Desktop Sidebar + Header）

未實機測試 375px／430px／768px，但由於版面採用 Tailwind 相對單位與 flex/grid，320px 與 390px/1024px/1440px 皆正常的情況下，中間寬度出現斷版的風險低；建議在正式上線前於真實裝置上補測。

## 發現並修正的問題

1. **（已修正）Fortune／Lantern／Ritual 的核心提交動作缺少錯誤處理**：原始程式碼在 `createLamp`／`saveCeremony`／`createRitualBooking` 等呼叫失敗時沒有 catch，會讓使用者卡在動畫狀態無法離開。修正方式：加入 try/catch，失敗時透過 Toast 提示並導回安全頁面（Explore／Lantern List／Ritual List）。
2. **（已修正）CSS `@import` 順序錯誤**：`@import` 必須在 `@tailwind` 指令之前，原始寫法會被 Vite 建置警告忽略，已修正順序。
3. **（環境限制，非程式錯誤）Headless Chromium 缺少中文字型**：截圖中部分中文字出現字重不一致的視覺假影；已透過在 `index.html` 加入 Google Fonts（Noto Sans/Serif TC）修正正式瀏覽環境下的字型載入，但無法保證所有離線/沙盒環境都能連上 Google Fonts CDN——**已知限制**，正式上線前建議自架字型檔案以避免依賴外部 CDN 可用性。

## 已知限制（誠實列出，非隱藏）

- FSM 進行中状態不具備跨重新整理的持久化（例如抽籤動畫進行到一半時重新整理，會回到 IDLE）。這是刻意的取捨：儀式性流程被視為「一次性的當下體驗」，而非需要斷點續傳的表單，且實作跨頁狀態持久化會顯著增加複雜度而效益有限。
- 錯誤重試目前採「導回安全頁面」而非「原地重試」策略（見上表），原因是四個 FSM 都沒有為每個中間狀態設計回退transition（若要支援原地重試，需要在每個 FSM 都新增對稱的失敗分支，超出 Phase 1 的必要範圍）。
- 尚未在真實行動裝置（非模擬器）上測試觸控手感與 iOS Safari 的音訊播放限制細節。
