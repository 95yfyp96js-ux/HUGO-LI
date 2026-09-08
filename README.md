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
docs/ASSUMPTIONS.md        規格未明確指定之處的假設，以及本次開發環境限制
```

三個 `packages/*` 皆為平台無關的純 Dart 套件（不依賴 Flutter），`apps/mobile`
只負責 UI 與資料庫接線，不內嵌任何計息或攤還公式。

## 環境需求

- Flutter 3.x（含對應 Dart SDK）
- Android Studio（含 Android SDK）或 Xcode（iOS 模擬器），視你要跑哪個平台
- 詳見 `docs/ASSUMPTIONS.md`：本次開發沙盒環境沒有模擬器，已改用
  headless widget test 驗證四步上手流程可跑通；第三方在有 Android
  Studio / Xcode 的一般開發機上，依下方指令即可在模擬器或實機執行。

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
（875 個測試，涵蓋 EMI/EPP/IO/BULLET 四種方式 × 多組本金/利率/期數組合，
驗證「本金加總＝貸款本金」「末期餘額＝0」兩項不變式）。

貸款狀態機、期別狀態機、授權狀態機見
[`docs/state-machines.md`](docs/state-machines.md)。

## 授權（License）

- 未啟用時可自由瀏覽、產生報表、匯出；「新增貸款」「確認撥款」累計滿 10
  次後鎖定寫入。
- 正式授權碼：`packages/license` 用 HMAC-SHA256 做離線簽章與驗證，格式
  `<payload base64url>.<簽章 hex>`；一機一碼（見 `docs/ASSUMPTIONS.md` §6、§9
  的示範用途與已知限制）。
- 開發時可用 `--dart-define=DEV_LICENSE=1` 完全略過試用限制。

## 資料安全與備份

- 本機 SQLite（SQLCipher 加密）儲存，**不上傳任何伺服器**。
- 身分證字號／完整地址／銀行帳號：應用層 AES-256-GCM 加密存密文，另存
  SHA-256 雜湊供查重（不明文比對），畫面一律遮罩顯示末 4 碼。
- 設定頁「匯出備份」可把目前資料庫複製一份到本機 `backups/` 子目錄。

## 完成定義檢查

- [x] `packages/lending_engine` / `ledger` / `license` 測試全過（`dart test`）
- [x] `apps/mobile` 分析無 error（`flutter analyze`）
- [x] Widget test 模擬走完四步上手，且看板數字（由 Ledger 重放得出）與
      Ledger 分錄一致（`apps/mobile/test/golden_path_test.dart`）
- [x] 部分還本後最終全額清償，期末餘額為 0
      （`apps/mobile/test/loan_repository_test.dart`）
- [x] 身分證字號畫面遮罩、DB 只存密文＋雜湊
- [ ] 第三人在有 Android Studio / Xcode 的機器上，依本 README 指令
      `flutter run` 實際跑起來（本沙盒環境無模擬器，未能親自驗證，見
      `docs/ASSUMPTIONS.md`）

## 禁止事項（本系統刻意不做）

- 不做真聯徵／金流串接。
- 不自動核准貸款；若之後接上核貸建議模組，只能輸出
  `APPROVE_RECOMMEND / REFER / REQUEST_INFO / DECLINE_RECOMMEND / ESCALATE_FRAUD`
  五種建議之一，不直接改變貸款狀態。
- 不在 Widget 內寫任何攤還／計息公式（一律呼叫 `lending_engine`）。
- 不用 `double` 做金錢運算（一律整數分 + `Decimal`）。
- 不提供保證過件、規避徵信／AML 等文案或功能。
