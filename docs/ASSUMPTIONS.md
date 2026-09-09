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
   6%、ACT/365（僅在 `penaltyEnabled=true` 時生效，可於登記貸款時調整）。
   計算方式：**每一期各自從自己的「到期日 + 寬限天數」起算**，基數為該期
   尚未收到的本金＋利息，不是拿逾期總額乘最長天數。已入帳的 `PENALTY`
   分錄會從應計中扣除，不重複計提。固定數字見
   `packages/lending_engine/test/penalty_test.dart` 與
   `apps/mobile/test/penalty_test.dart`。
6. 授權：試用預設 10 次「新增貸款」+「確認撥款」累計次數；DEV_LICENSE
   dart-define 直接視為 `LICENSED`，不消耗次數、不需簽章驗證。正式授權碼
   採 HMAC-SHA256（授權碼內嵌 payload + 簽章）。**簽章密鑰由建置時的
   `--dart-define=LICENSE_HMAC_KEY=...` 帶入，原始碼裡沒有任何預設密鑰**：
   沒帶就 `licenseSigningConfigured == false`，任何授權碼一律驗不過、App
   停留在試用模式。與其在程式碼裡放一組人人拿得到的「示範密鑰」讓人誤以為
   有保護，不如明說這個 build 沒有授權能力（設定頁也照實寫）。即使帶了密鑰
   仍是示範等級：密鑰會被打進二進位檔，反編譯即可自簽；試用次數存在本機
   資料庫，重裝或還原舊備份即可退回舊值。裝置綁定用裝置安裝識別碼
   （`device_info_plus` 或本地隨機產生並持久化的 UUID，本沙盒無法安裝
   `device_info_plus` 原生插件驗證，改用可注入的 `DeviceIdProvider` 介面，
   Flutter 端用套件、測試端用假實作）。
7. 身分證字號等敏感欄位：畫面一律遮罩（顯示末 4 碼），DB 內以應用層加密
   （AES-256-GCM，金鑰衍生自 SQLCipher 主密碼）存密文欄位＋另存
   `idHash`（SHA-256）供查重比對，不明文比對。
8. 看板（Dashboard）指標定義（2026-09 修訂，見 docs/MANUAL-QA.md「已修」）：
   - 在貸本金 = 由分錄重放得出：撥款 − 已收本金 ± 調整。單筆收超過撥款時
     不倒扣（下限 0）。
   - 待收利息 = 合約上尚未收到的利息：所有未繳清期別（**含尚未到期**）的
     利息缺口加總，再加未出帳的日結應計利息。
   - 待收金額 = 在貸本金 ＋ 待收利息。**刻意不採用「已出帳未收」的定義**：
     撥出 10 萬、第 1 期還沒到期時，後者會顯示 0，而出借人看到 0 只會理解成
     「沒人欠我錢」。
   - 已收利息 = 所有 `INTEREST` 類收款分錄加總。
   - 逾期金額 = 已出帳且逾寬限期未繳清期別之應繳合計，扣除已收部分。
   - 累計撥款 = 所有 `DISBURSEMENT` 分錄加總（含已結清者；不含尚未撥款的
     DRAFT）。撥出去的錢不會因為收回來就沒發生過，所以它只增不減。

9. 金額顯示規則（見 `apps/mobile/lib/widgets/format.dart`）：可操作金額
   （應繳、差額、餘額、逐期本息）一律顯示到「分」；只有看板概覽卡用整元，
   規則寫死為 ROUND_HALF_UP。使用者輸入的元字串以字串拆解轉成分，不經過
   `double`（`8884.88 * 100` 在浮點下是 888487.99…，截斷會少 1 分）。
10. 一機一碼：同一授權碼在新裝置啟用時，需先於原裝置或客服流程「解綁」
   （本地端以最後啟用裝置為準，示範用途；無雲端後端做真正的唯一性仲裁，
   此限制已於 README 註明）。

11. 備份檔格式（`.slbak`，`kBackupFormat = "SLOS-BACKUP"`，version 1）：
    外層是純文字 JSON 信封（看得出這是什麼檔、版本對不對），內容為
    AES-256-GCM 密文，金鑰由使用者口令經 PBKDF2-HMAC-SHA256（預設 150,000
    次迭代、隨機 salt）衍生。**匯出的是「資料內容」（全表 JSON）而不是
    SQLCipher 資料庫檔案**：檔案層備份綁死在原本的 DB 金鑰上，換裝置、換
    金鑰就打不開，而且還原時無法先驗證再替換。還原順序固定為
    「先存救援備份 → 解密驗證 → 才替換」，口令錯會在 GCM 驗證階段失敗，
    所以「口令錯 → 現庫不動」是密碼學保證而非事後檢查。
    口令不儲存在 App 內，忘記即無法還原。
    備份含 `app_license_rows`，**還原舊備份會一併還原試用次數**（見 §6，
    這也是這版授權不能當收費閘門的原因之一）。

12. 資料庫金鑰存放：iOS Keychain / Android EncryptedSharedPreferences
    （`flutter_secure_storage`，`first_unlock` 可用性）。舊版存在
    SharedPreferences 明文的金鑰於啟動時做一次性遷移，順序為
    「寫入安全儲存 → 讀回核對值一致 → 才刪除明文」；核對失敗即拋
    `DbKeyMigrationException` 並**保留明文**——寧可留著明文，也不要在搬遷
    途中把金鑰弄丟、讓整個 SQLCipher 資料庫永遠打不開。設定頁「儲存狀態」
    顯示金鑰來源（安全儲存／本次遷移／本次新建），**不顯示金鑰本身**。

13. SQLCipher 強制開啟：`--dart-define=DISABLE_DB_ENCRYPTION=true` 只在
    debug/profile build 有效（以 `assert` 是否被移除判斷），release build
    一律加密，不可能靠傳旗標把上架版本變成明文。

14. 「提前還本」提醒門檻：收款金額沖完**最早一期未繳清的期別**之後，還往後
    碰到尚未到期的期別，才跳提醒。單純在到期日之前繳掉當期不算——那是最常見
    的正常繳款方式（收款對話框預設帶入的就是這個金額），每次都跳提醒只會
    讓人閉著眼睛點過去，連帶讓真正該看的溢繳提醒失效。溢繳（沖完全部未繳
    期別後仍有剩）則一律提醒。

15. 範例資料（設定頁「載入範例資料」，僅 debug）：只新增、不刪除，身分證
    使用 `Z9…` 假號段以避開手動驗收腳本要求輸入的 `A123456789`（撞號會被
    查重擋下，整個載入中途失敗）。庫裡已有資料時由呼叫端做二次確認。

16. 單筆 CSV 匯出：**不含未遮罩的身分證字號**（CSV 會進 Excel、會被寄來寄
    去），只放姓名與末 4 碼遮罩；金額一律以「元.分」輸出，不做四捨五入。
