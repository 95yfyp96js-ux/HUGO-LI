# 本機安裝與執行

目標：從零把這個專案跑到你手上的手機或模擬器，然後照
[MANUAL-QA.md](MANUAL-QA.md) 走一次驗收。

**先講驗證狀態，免得你踩到才發現：**

| 步驟 | 我驗過了嗎 |
|---|---|
| 安裝 SDK、`pub get`、`build_runner`、`analyze`、`test` | ✅ 全部在這個專案上實際跑過 |
| `flutter run` 到真機／模擬器、`build apk`、`build ios` | ❌ **沒有**。開發環境沒有 Android SDK／Xcode／模擬器 |

也就是說：下面第 1～4 節是照著跑就會過的；**第 5 節（跑到裝置上）是我照
官方文件與這個專案的相依關係寫的，沒有人實際執行過。**卡住很正常，把錯誤
訊息貼回來即可。

---

## 1. 安裝 Flutter SDK

需要 Flutter 3.27 以上（開發時用 3.47.2 / Dart 3.13）。

```bash
# macOS（建議）
brew install --cask flutter

# 或手動下載
# https://docs.flutter.dev/get-started/install

flutter --version   # 確認 3.27+
```

## 2. 安裝平台工具（擇一或都裝）

**Android**

1. 裝 [Android Studio](https://developer.android.com/studio)。
2. 首次啟動時讓它裝完 Android SDK、Platform-Tools、一個 Emulator image。
3. 接受授權：`flutter doctor --android-licenses`

**iOS（只有 macOS 能做）**

1. 從 App Store 裝 Xcode，開一次讓它裝完元件。
2. `sudo xcodebuild -license accept`
3. `sudo gem install cocoapods`（或 `brew install cocoapods`）

最後確認：

```bash
flutter doctor -v
```

Android 或 iOS 其中一欄是 ✓ 就夠了，兩個都要打勾不是必要條件。

## 3. 取得專案並安裝相依

```bash
git clone <repo-url>
cd HUGO-LI

# 三個純 Dart 套件：先確認引擎本身是好的
cd packages/lending_engine && dart pub get && dart test && cd -
cd packages/ledger         && dart pub get && dart test && cd -
cd packages/license        && dart pub get && dart test && cd -

# App
cd apps/mobile
flutter pub get
```

預期：三個套件分別 **892 / 19 / 21** 支測試全過。任何一支紅的就先別往下走，
那代表引擎有問題，跑到手機上也只是把錯的數字顯示得比較漂亮。

## 4. 產生 Drift 程式碼（**不做這步會編不起來**）

資料庫的 `app_database.g.dart` 沒有進版控（見根目錄 `.gitignore`），
必須自己產：

```bash
cd apps/mobile
dart run build_runner build --delete-conflicting-outputs
```

第一次會花 1～2 分鐘（要編 builder）。之後改了 `lib/db/tables.dart` 要重跑。

接著跑一次靜態分析與測試：

```bash
flutter analyze     # 預期：No issues found!
flutter test        # 預期：76 支全過
```

## 5. 跑到裝置上

```bash
flutter devices              # 確認抓得到裝置
cd apps/mobile
flutter run                  # 一般模式：試用次數會真的累加
```

**做手動驗收請務必用一般模式**（不要加下面的旗標），否則
MANUAL-QA 第 10 步的試用次數驗不到：

```bash
# 開發用：略過 10 次試用限制，不消耗次數
flutter run --dart-define=DEV_LICENSE=1
```

Debug 版的設定頁會多一個「載入範例資料」按鈕（Release 版沒有），
MANUAL-QA 第 14 步會用到。

### 建置旗標一覽

| 旗標 | 作用 | 什麼時候用 |
|---|---|---|
| `--dart-define=DEV_LICENSE=1` | 略過 10 次試用限制，不消耗次數 | 開發。**做手動驗收不要加**，第 10 步驗不到 |
| `--dart-define=DISABLE_DB_ENCRYPTION=true` | 用一般 sqlite3 開檔（明文），方便用 DB 工具直接看內容 | 只在 debug/profile 有效；**release build 會直接忽略它**，不可能靠它把上架版本變明文。加了之後設定頁「儲存狀態」會顯示紅色「資料庫加密：關閉（開發模式）」 |
| `--dart-define=LICENSE_HMAC_KEY=<字串>` | 授權碼的簽章密鑰 | 不帶就**完全沒有授權能力**（任何授權碼都驗不過，只能用 10 次試用）。這是刻意的——原始碼裡不放預設密鑰。即使帶了也只是示範等級，見 MANUAL-QA「還不能封測」B 組第 5 項 |

三個旗標可以同時傳：

```bash
flutter run \
  --dart-define=DEV_LICENSE=1 \
  --dart-define=DISABLE_DB_ENCRYPTION=true
```

### 備份檔在哪裡

設定頁「匯出備份」會寫到 App 文件目錄下的 `backups/`：

```
<app documents>/backups/lending-backup-<timestamp>.slbak   # 手動匯出
<app documents>/backups/rescue-<timestamp>.slbak           # 還原前自動存的救援備份
```

「從備份還原」只列得出這個資料夾裡的檔案——**目前沒有接系統檔案選取器或
分享功能**（那是原生外掛，這個環境驗不了）。換手機時要自己用電腦端工具把
檔案搬過去：

```bash
# Android
adb exec-out run-as com.smalllendingos.mobile tar c files/backups \
  > /tmp/backups.tar
# iOS：Finder → 你的裝置 → 檔案 → 這個 App → 拖出來
```

還原時把 `.slbak` 檔放回新裝置的同一個 `backups/` 目錄，設定頁就會列出來。

### 已知的建置風險（沒驗證過，優先懷疑這幾項）

1. **SQLCipher 與一般 sqlite3 打架。**
   `sqlcipher_flutter_libs` 與 `sqlite3_flutter_libs` 各自打包一份原生
   sqlite3，同時存在時 App 可能載到沒有加密能力的那一份。本專案已只保留
   `sqlcipher_flutter_libs`。若你自己加了其他用到 sqlite 的套件，先確認
   它有沒有把 `sqlite3_flutter_libs` 拉回來（`flutter pub deps | grep sqlite`）。

2. **Android minSdk。** SQLCipher 需要較新的 NDK/ABI 支援。若出現
   `minSdkVersion` 相關錯誤，在 `android/app/build.gradle.kts` 把
   `minSdk` 提到 23 以上。

3. **iOS pod 安裝。** 第一次 `flutter run` 前若沒自動跑，手動執行：
   ```bash
   cd apps/mobile/ios && pod install && cd -
   ```
   SQLCipher 的 pod 較大，第一次會下載一陣子。

4. **模擬器上的加密資料庫。** iOS 模擬器與部分 Android 模擬器映像對原生
   函式庫的支援與實機不同。**建議用實機做驗收**，尤其是 MANUAL-QA 第 10 步
   （重啟後資料還在不在）。

### 驗證資料真的有加密（值得花兩分鐘）

跑完驗收後，把資料庫檔案拉出來用一般 `sqlite3` 開：

```bash
# Android
adb exec-out run-as com.smalllendingos.mobile cat \
  files/lending.db > /tmp/lending.db     # 路徑依 path_provider 實際位置調整
sqlite3 /tmp/lending.db ".tables"
```

**預期會失敗**（`file is not a database`）。如果它成功列出資料表，代表
加密沒有生效——這是嚴重問題，立刻停止封測。

---

## 常見卡關

| 症狀 | 原因與處理 |
|---|---|
| `Target of URI doesn't exist: 'app_database.g.dart'` | 沒跑第 4 節的 `build_runner` |
| `flutter pub get` 解不出相依 | Flutter 版本太舊，`flutter upgrade` 後重試 |
| 進 App 立刻閃退 | 多半是資料庫開啟失敗（SQLCipher 沒正確連結）。用 `flutter run` 看主控台，把 `PRAGMA key` 附近的錯誤貼出來 |
| 看板一直是 0 | 正常——建約不寫分錄，要按「確認撥款」才會有數字（不變式 2） |
| 「試用次數已用盡」 | 已用滿 10 次寫入。重裝 App 或改用 `--dart-define=DEV_LICENSE=1` |
