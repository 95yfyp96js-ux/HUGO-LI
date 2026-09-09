# 小額放款帳戶系統（Small Lending OS — Loan Account）

出借人端小額放款帳戶系統：貸款帳簿＋還款計畫＋入帳引擎。本機執行、
SQLCipher 加密儲存、不上傳伺服器。系統**永不自動核准貸款**；若啟用核貸
建議模組，也只能輸出建議，最終仍由人工決定。

## 專案結構

```
apps/mobile/               Flutter App（UI、Drift/SQLCipher、riverpod、go_router）
packages/lending_engine/   計息、攤還計畫、狀態機、瀑布、日結（純 Dart，UI 不得內嵌公式）
packages/ledger/           Append-only 分錄、重放、看板聚合（純 Dart）
packages/license/          試用次數、裝置綁定、離線授權碼驗證（純 Dart）
docs/interest-rules.md     計息與還款計畫規則（測試鎖定的規格來源）
docs/state-machines.md     貸款狀態機、期別狀態機、授權狀態機
docs/RUNNING.md            本機安裝與 flutter run 步驟、已知建置風險
docs/MANUAL-QA.md          16 步手動驗收腳本（含預期數字）與「還不能封測」清單
docs/ASSUMPTIONS.md        規格未明確指定之處的假設，以及本次開發環境限制
```

三個 `packages/*` 皆為平台無關的純 Dart 套件（不依賴 Flutter），`apps/mobile`
只負責 UI 與資料庫接線，不內嵌任何計息或攤還公式。

## 環境需求

- Flutter 3.27 以上（開發時用 3.47.2 / Dart 3.13）
- Android Studio（含 Android SDK）或 Xcode，視你要跑哪個平台
- **完整安裝步驟、已知建置風險與常見卡關見 [`docs/RUNNING.md`](docs/RUNNING.md)**
- 詳見 `docs/ASSUMPTIONS.md`：本次開發環境沒有模擬器，已改用 headless
  widget test 驗證流程；真機執行與建置尚未被驗證過。

## 快速開始

```bash
# 1. 安裝三個純 Dart 套件的依賴並跑測試（先確保引擎全綠）
cd packages/lending_engine && dart pub get && dart test && cd -
cd packages/ledger         && dart pub get && dart test && cd -
cd packages/license        && dart pub get && dart test && cd -

# 2. 安裝 App 依賴、產生 Drift 程式碼
cd apps/mobile
flutter pub get
dart run build_runner build --delete-conflicting-outputs

# 3. 跑 App 測試（含四步上手端對端 widget test）
flutter test

# 4. 靜態分析（要求 0 error）
flutter analyze

# 5. 在模擬器／實機上執行（一般模式，計入 10 次免費試用）
flutter run

# 5'. 開發模式：略過試用次數限制（不消耗次數、不需授權碼）
flutter run --dart-define=DEV_LICENSE=1
```

建置旗標（`DEV_LICENSE` / `DISABLE_DB_ENCRYPTION` / `LICENSE_HMAC_KEY`）
的完整說明見 [`docs/RUNNING.md`](docs/RUNNING.md)。

## 四步上手

1. **新增借款人** — 姓名、身分證字號（僅加密存放＋雜湊查重，畫面一律遮罩顯示末 4 碼）、聯絡方式。
2. **登記貸款** — 選還款方式（EMI／EPP／IO／BULLET）、利率類型（月／年／日／期）、期數等，按「建立貸款（建約）」。
3. **自動生成計畫** — 建立貸款的同時，`lending_engine` 已產生完整還款計畫並顯示在貸款詳情頁（此時尚未撥款、尚未計息、未寫入任何分錄）。
4. **確認撥款並追蹤還款** — 在貸款詳情頁按「確認撥款」（與登記/建約是分開的按鈕），系統寫入撥款分錄、正式開始計息；之後可用「記一筆還款」入帳，看板數字即時反映。

「新增貸款」與「確認撥款」是唯二計入 10 次免費試用的動作；用滿後需在設定頁輸入授權碼才能繼續寫入（瀏覽、報表、匯出不受限）。

## 領域規則

計息公式、四種還款方式、利率換算、入帳瀑布順序、日結、提前還本規則，全部
寫在 [`docs/interest-rules.md`](docs/interest-rules.md)，並由
`packages/lending_engine/test/` 的固定數字案例與跨參數不變式測試鎖定
（892 個測試，涵蓋 EMI/EPP/IO/BULLET 四種方式 × 多組本金/利率/期數組合，
驗證「本金加總＝貸款本金」「末期餘額＝0」兩項不變式；另有
`golden_lifecycle_test.dart` 鎖定「整份計畫表逐期依瀑布沖銷到結清」的黃金案例）。

貸款狀態機、期別狀態機、授權狀態機見
[`docs/state-machines.md`](docs/state-machines.md)。

## 授權（License）

- 未啟用時可自由瀏覽、產生報表、匯出；「新增貸款」「確認撥款」累計滿 10
  次後鎖定寫入。
- 正式授權碼：`packages/license` 用 HMAC-SHA256 做離線簽章與驗證，格式
  `<payload base64url>.<簽章 hex>`；一機一碼（見 `docs/ASSUMPTIONS.md` §6、§10
  的示範用途與已知限制）。
- **簽章密鑰由 `--dart-define=LICENSE_HMAC_KEY=...` 帶入，原始碼裡沒有預設
  密鑰**。沒帶就沒有授權能力（任何授權碼都驗不過，只能用 10 次試用）。
- **這個機制是示範等級，可以被破解**：密鑰打進二進位檔、反編譯即可自簽；
  試用次數存在本機資料庫，重裝或還原舊備份就會退回舊值。設定頁有同樣的
  告知，並明講**禁止當成正式收費閘門、禁止在本 App 存任何真實金流密碼**。
- 開發時可用 `--dart-define=DEV_LICENSE=1` 完全略過試用限制。

## 資料安全與備份

- 本機 SQLite（SQLCipher 加密）儲存，**不上傳任何伺服器**。Release build
  一律加密；`--dart-define=DISABLE_DB_ENCRYPTION` 只在 debug/profile 有效。
- 資料庫金鑰存放於 iOS Keychain／Android Keystore；舊版存在
  SharedPreferences 的明文金鑰會在啟動時一次性遷移，**先讀回核對一致才刪除
  明文**，核對失敗就保留明文並報錯（寧可留明文，也不要把資料庫鎖死）。
  設定頁「儲存狀態」顯示加密開／關與金鑰來源，**不顯示金鑰本身**。
- 身分證字號／完整地址／銀行帳號：應用層 AES-256-GCM 加密存密文，另存
  SHA-256 雜湊供查重（不明文比對），畫面一律遮罩顯示末 4 碼。
- 設定頁「匯出備份／從備份還原」：`.slbak` 加密備份（AES-256-GCM ＋
  PBKDF2-HMAC-SHA256 150,000 次迭代），匯出的是**資料內容**而非資料庫檔案，
  換裝置、換金鑰都還原得回來。還原前一定先自動存一份救援備份；口令錯或
  檔案毀損時直接中止，現有資料不動。口令不存在 App 裡，忘記就解不開。
- 單筆貸款可匯出 CSV（計畫表＋實收＋分錄）供對帳，**不含未遮罩的身分證
  字號**。

## 金額規則

帳務內部一律整數「分」。畫面上只有兩種呈現：可操作金額（應繳、差額、餘額、
逐期本息）**顯示到分**；看板概覽卡用整元，規則寫死為 ROUND_HALF_UP。
收款金額預設帶入本期應繳的精確分值，差額小於 1 元也會顯示成「尚差 NT$0.88」。
輸入解析全程走字串、不經過 `double`。規則由 `apps/mobile/test/format_test.dart` 鎖住。

## 手動驗收

自動化測試證明不了觸控、鍵盤遮擋、字級、真機效能與「重啟後資料還在」。
拿到裝置後請照 [`docs/MANUAL-QA.md`](docs/MANUAL-QA.md) 走 16 步，
每一步的預期數字都由 `apps/mobile/test/manual_qa_script_test.dart` 鎖住
（文件與程式對不上時測試會先失敗）。該文件末尾的「還不能封測」清單是目前
已知、擋著封測的問題。

## 完成定義檢查

- [x] `packages/lending_engine` / `ledger` / `license` 測試全過（`dart test`）
- [x] `apps/mobile` 分析無 error（`flutter analyze`）
- [x] Widget test 模擬走完四步上手，且看板數字（由 Ledger 重放得出）與
      Ledger 分錄一致（`apps/mobile/test/golden_path_test.dart`）
- [x] 部分還本後最終全額清償，期末餘額為 0
      （`apps/mobile/test/loan_repository_test.dart`）
- [x] 身分證字號畫面遮罩、DB 只存密文＋雜湊
- [x] 金額全面對齊到分，收款預設帶入精確應繳（`test/format_test.dart`）
- [x] 撥款日可補登歷史日期、不可選未來
- [x] 看板「待收金額」＝在貸本金＋待收利息，撥款後不會顯示 0
- [x] 加密備份／還原，還原前自動存救援備份，口令錯不動現庫
      （`apps/mobile/test/backup_test.dart`）
- [x] 資料庫金鑰搬到 Keychain／Keystore，遷移失敗不刪明文
      （`apps/mobile/test/db_key_store_test.dart`）
- [x] 溢繳／提前還本入帳前先解釋並確認
      （`test/payment_preview_test.dart`、`test/overpayment_dialog_test.dart`）
- [x] 罰息長情境固定數字測試（連續逾期 3 期、寬限期內外、開／關）
      （`packages/lending_engine/test/penalty_test.dart`、
      `apps/mobile/test/penalty_test.dart`）
- [x] 載入範例資料不毀既有資料、已有資料時二次確認
      （`apps/mobile/test/seed_guard_test.dart`）
- [x] 單筆 CSV 匯出不含未遮罩身分證字號（`apps/mobile/test/loan_csv_test.dart`）

需要真機才能打勾的（見 `docs/MANUAL-QA.md`「還不能封測」A 組）：

- [ ] 第三人在有 Android Studio / Xcode 的機器上依 `docs/RUNNING.md`
      實際 `flutter run` 起來（本環境無模擬器，未能親自驗證）
- [ ] 有人照 `docs/MANUAL-QA.md` 在真機上走完 16 步
- [ ] 確認 `lending.db` 用一般 `sqlite3` 打不開（SQLCipher 真的生效）
- [ ] 確認 Keychain／Keystore 遷移在真機上顯示正確的金鑰來源

本階段刻意不做（見「還不能封測」B 組）：備份檔的 App 內分享／檔案選取器、
溢繳退款流程、跨貸款總帳與 PDF 對帳單、核貸建議 UI 入口。

## 禁止事項（本系統刻意不做）

- 不做真聯徵／金流串接。
- 不自動核准貸款；若之後接上核貸建議模組，只能輸出
  `APPROVE_RECOMMEND / REFER / REQUEST_INFO / DECLINE_RECOMMEND / ESCALATE_FRAUD`
  五種建議之一，不直接改變貸款狀態。
- 不在 Widget 內寫任何攤還／計息公式（一律呼叫 `lending_engine`）。
- 不用 `double` 做金錢運算（一律整數分 + `Decimal`）。
- 不提供保證過件、規避徵信／AML 等文案或功能。
