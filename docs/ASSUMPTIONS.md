# 假設與環境限制

本文件列出規格未明確指定、由實作時自行決定的假設，以及本次開發環境的限制。

## 環境限制

- 本沙盒環境**沒有預裝 Flutter/Dart SDK、Android SDK、Chrome、Linux GTK
  桌面依賴，也沒有 Android/iOS 模擬器或實體裝置**。開發過程中已自行下載
  安裝 Dart 3.13 與 Flutter 3.47（stable）SDK 以執行 `dart analyze` /
  `dart test` / `flutter analyze` / `flutter test`（Widget test 使用
  headless flutter tester，不需要裝置）。
- **無法**在真機／模擬器上手動點擊走完四步上手流程並肉眼確認畫面；也無法
  產生螢幕截圖。已改以 Widget test（`apps/mobile/test/`）模擬使用者操作
  路徑（新增借款人 → 登記貸款 → 產生計畫 → 確認撥款 → 還款 → 看板數字）
  來驗證流程可跑通、看板數字與 Ledger 分錄一致。第三方使用者在有 Android
  Studio / Xcode 的環境下，依 README 指示即可在模擬器或實機上實際操作。
- `sqlcipher_flutter_libs` 需要平台原生函式庫，無法在本沙盒的 `flutter test`
  （純 Dart VM，無平台 plugin）環境下端對端測試加密開檔；因此
  `packages/lending_engine` / `packages/ledger` / `packages/license` 全數為
  **平台無關的純 Dart 套件**，用一般 `dart test` 驗證（不依賴 Flutter 或
  SQLCipher），Drift/SQLCipher 只在 `apps/mobile` 的 repository 層接線，
  其正確性由純 Dart 的 in-memory Drift（NativeDatabase.memory）測試覆蓋。

## 規則假設

1. **BULLET 一次本息還款計畫只產生 1 筆到期分錄**（本金＋全期利息），期間
   應計利息由日結逐日累加、供查詢，不在 `schedule_items` 另開分期項目。
   `tenorPeriods * periodDays` 決定到期天數。
2. 四捨五入統一 `ROUND_HALF_UP`，只在「寫入單期本金／利息」當下取整到分；
   末期一律用「剩餘本金」反推，確保帳務軋平（見 interest-rules.md §7）。
3. EMI／EPP 每期「應繳總額」在期初鎖定（不因日結補計息而每日變動），日結
   只累積「未出帳應計利息」，於期別出帳時併入當期利息。
4. 逾期認定：`dueDate + graceDays（預設3天） < today` 且未全額繳清。
   `DELINQUENT → DEFAULT` 門檻預設 90 天連續逾期（可於設定調整，非本次
   UI 必要範圍，先寫入 domain 常數）。
5. 罰息預設關閉；啟用後之罰息率為貸款自訂欄位，未特別要求則預設年化
   6%（僅在 `penaltyEnabled=true` 時生效，可於登記貸款時調整）。
6. 授權：試用預設 10 次「新增貸款」+「確認撥款」累計次數；DEV_LICENSE
   dart-define 直接視為 `LICENSED`，不消耗次數、不需簽章驗證。正式授權碼
   採 HMAC-SHA256（授權碼內嵌 payload + 簽章，公鑰/密鑰於 `packages/license`
   常數中，屬示範用途，非正式金鑰管理）。裝置綁定用裝置安裝識別碼
   （`device_info_plus` 或本地隨機產生並持久化的 UUID，本沙盒無法安裝
   `device_info_plus` 原生插件驗證，改用可注入的 `DeviceIdProvider` 介面，
   Flutter 端用套件、測試端用假實作）。
7. 身分證字號等敏感欄位：畫面一律遮罩（顯示末 4 碼），DB 內以應用層加密
   （AES-256-GCM，金鑰衍生自 SQLCipher 主密碼）存密文欄位＋另存
   `idHash`（SHA-256）供查重比對，不明文比對。
8. 看板（Dashboard）四項指標定義：
   - 貸款總額 = 所有 `DISBURSEMENT` 分錄加總（不含尚未撥款的 DRAFT）。
   - 已收利息 = 所有 `INTEREST` 類收款分錄加總。
   - 待收金額 = 所有未出帳＋已出帳未繳期別之「應繳本金＋利息」加總，扣除
     已收部分（用 Ledger 重放得出，不直接加總 Schedule）。
   - 逾期金額 = 狀態為 `OVERDUE` 期別之未繳餘額加總。
9. 一機一碼：同一授權碼在新裝置啟用時，需先於原裝置或客服流程「解綁」
   （本地端以最後啟用裝置為準，示範用途；無雲端後端做真正的唯一性仲裁，
   此限制已於 README 註明）。
