# 計息與還款計畫規則

本文件是 `packages/lending_engine` 的規格來源。任何計算邏輯異動，先改本文件，
再改測試，最後改實作。所有金額一律以「整數分」（TWD cents，`int`）表示，
利率與中間計算一律使用 `Decimal`（`package:decimal`），**禁止使用 `double`
做金錢或利率運算**。

## 1. 基本輸入

一筆貸款登記時鎖定下列欄位（連同當下的規則版本 `rule_version`）：

| 欄位 | 說明 |
|---|---|
| `principalCents` | 本金（分） |
| `method` | 還款方式：`EMI` / `EPP` / `IO` / `BULLET` |
| `rateType` | 利率類型：`MONTHLY` / `ANNUAL` / `DAILY` / `PERIOD` |
| `rateBps` | 利率，基點（1% = 100 bps），對應 `rateType` 的期間單位 |
| `tenorPeriods` | 期數（`BULLET` 亦需填，用於算到期天數） |
| `periodDays` | 每期天數，預設依 `rateType`（見下表），使用者可覆寫 |
| `dayCount` | 日數基礎：`THIRTY_360` / `ACT_365` / `ACT_360` |
| `graceDays` | 寬限天數，預設 3 |
| `penaltyEnabled` | 罰息是否啟用，預設 `false` |

### 1.1 `periodDays` 與 `dayCount` 預設值

| rateType | 預設 periodDays | 預設 dayCount |
|---|---|---|
| MONTHLY | 30 | THIRTY_360 |
| ANNUAL（分期） | 30（用 /12 換算，不逐日） | THIRTY_360 |
| ANNUAL（指定按日） | 使用者輸入之實際天數 | ACT_365 |
| DAILY | 1（乘以實際天數） | ACT_365 |
| PERIOD | 使用者輸入之 `periodDays` | 使用者輸入，預設 ACT_365 |
| BULLET（到期日累計） | 全期天數 = `tenorPeriods * periodDays` | ACT_365 |

## 2. 期間利率換算（`PeriodRate`）

每一期的期間利率 `r`（`Decimal`，例如 1% 記為 `0.01`）依 `rateType` 換算：

- **MONTHLY**：`r = rateMonth`（`rateBps / 10000`），每期固定用一期（預設 30 天，
  不因月份天數不同而調整，即 THIRTY_360 精神）。
- **ANNUAL**：
  - 分期模式（預設）：`r = rateYear / 12`。
  - 按日模式（`dayCount != THIRTY_360`）：`r = rateYear * actualDays / 365`。
- **DAILY**：`r = rateDay * actualDays`（`actualDays` 為該期實際天數）。
- **PERIOD**：`r` 直接等於輸入值（`rateBps / 10000`），天數採 `periodDays`
  （只影響日結 pro-rata，不影響期利率本身）。

`actualDays` 依 `dayCount`：
- `THIRTY_360`：固定 30 天／期。
- `ACT_365`：期間實際日曆天數（`endDate - startDate`），比率分母 365。
- `ACT_360`：期間實際日曆天數，比率分母 360。

## 3. 還款方式

以下 `n` = `tenorPeriods`，`P` = `principalCents`，`r` = 該期利率。所有中間值先以
`Decimal`（精度 ≥ 28 位）運算，**只在寫入每期本金／利息時四捨五入到分**
（`ROUND_HALF_UP`）。

### 3.1 EMI 等額本息

- `r = 0`：每期應繳本金 `A = P / n`（整除，餘數併入末期）。
- `r ≠ 0`：
  `A = P * r * (1+r)^n / ((1+r)^n - 1)`，先算出高精度 `A`，四捨五入到分得
  `roundedA`，作為第 1..n-1 期「應繳總額」。
  - 每期利息 `interest_t = round(balance_{t-1} * r)`。
  - 每期本金 `principal_t = roundedA - interest_t`（第 1..n-1 期）。
  - `balance_t = balance_{t-1} - principal_t`。
- **末期（第 n 期）**：不用 `roundedA`，改為
  `principal_n = balance_{n-1}`（全部剩餘本金），
  `interest_n = round(balance_{n-1} * r)`，
  `total_n = principal_n + interest_n`。
  此規則保證第 n 期後 `balance = 0`，無論前面四捨五入誤差多少（見不變式 §7）。

### 3.2 EPP 等額本金

- `principal_t = P div n`（整數分，向下取整），對 `t = 1..n-1`。
- `principal_n = P - principal_t * (n-1)`（吃掉所有餘數/尾差）。
- `interest_t = round(balance_{t-1} * r)`，隨餘額遞減。
- `balance_t = balance_{t-1} - principal_t`。

### 3.3 IO 先息後本

- 第 `1..n-1` 期：`principal_t = 0`，`interest_t = round(balance_{t-1} * r)`
  （`balance` 全期間 = `P`，因為未還本金）。
- 第 `n` 期：`principal_n = P`，`interest_n = round(P * r)`，
  `total_n = principal_n + interest_n`。

### 3.4 BULLET 一次本息

- 還款計畫僅 **1 期**（到期日一次結清），到期天數
  `totalDays = tenorPeriods * periodDays`（依 §1.1 預設或使用者覆寫）。
- 到期日利率 `r_total`：
  - `dayCount = ACT_365`：`r_total = dailyRate * totalDays` 或
    `annualRate * totalDays / 365`（依 `rateType` 換算基礎日利率後相乘）。
  - 其餘 `dayCount` 比照 §2 的日數基礎換算。
- `principal_1 = P`，`interest_1 = round(P * r_total)`，
  `total_1 = principal_1 + interest_1`。
- 期間仍由**日結**（見 §5）逐日產生應計利息分錄，供中途查詢「目前應計利息」，
  但正式的還款計畫只有到期日這 1 筆。

## 4. 提前還本 / 部分還本

- 部分還本金額優先沖銷 **當期已到期未繳** 的本金；超過當期應繳本金的部分，
  視使用者選擇：
  - 預設「重算未來期」：以繳款當下的剩餘本金與原利率、原方式，重新產生
    第 `t+1..n` 期計畫（`n` 不變，每期金額依新剩餘本金重算）。
  - 若使用者選「縮短期數」：改為 `n' < n`，其餘同上。
- 溢收（超過當期＋未來期總額）預設視為提前還本，觸發重算。
- 任何重算只影響**尚未入帳（PENDING/DUE）**的分錄；已入帳分錄不可修改，
  只能用調整分錄（沖正）處理（見不變式 §3、§6）。

## 5. 日結（Daily Accrual Batch）

- 觸發時機：App 啟動時自動執行一次；或使用者手動「補計息」。
- 對象：狀態為 `DISBURSED` / `CURRENT` / `DELINQUENT` 的貸款。
- 動作：從 `lastAccrualDate + 1` 到 `today`，逐日以日利率
  （由 §2 換算之期利率反推日利率：`dailyRate = r / actualDaysInPeriod`）
  計算應計利息，寫入 `ACCRUAL` 分錄（不改變 `schedule_items` 本金，只累加
  「未出帳應計利息」欄位，待下一期出帳時併入 `interest_t`）。
- 逾期判定：`schedule_items.dueDate + graceDays < today` 且該期未全額繳清
  → 該期狀態改 `OVERDUE`，貸款狀態可能轉 `DELINQUENT`。
- 罰息：`penaltyEnabled = true` 時，對逾期本金以罰息率逐日計提 `PENALTY`
  分錄；預設關閉（`penaltyEnabled = false` 時完全不計提）。

## 6. 入帳瀑布（Waterfall，固定順序，UI 不可調整）

收到一筆還款金額時，依序沖銷：

1. `PENALTY`（罰息）
2. `FEE`（手續費／違約金等其他費用）
3. `INTEREST`（含應計未出帳利息）
4. `PRINCIPAL`（本期應繳本金）
5. 全部繳清後仍有餘額 → 視為**溢收**，預設觸發「提前還本」並依 §4 重算剩餘
   計畫。

## 7. 不變式（引擎測試必須覆蓋）

1. 任一還款方式，`Σ principal_t (t=1..n) == P`（分毫不差）。
2. 最後一期結束後 `balance == 0`。
3. `Schedule` 可用相同輸入完全重算出相同結果（純函式、無副作用）。
4. `Ledger` 只追加；同一筆貸款的分錄重放（replay）得出的「已收利息」
   「已收本金」「待收本金」與 Schedule 呈現的累計數必須一致。
5. 金額欄位全程 `int`（cents），任何四捨五入只發生在「寫入單期金額」的
   那一刻，且統一 `ROUND_HALF_UP`。

## 8. 固定數字測試案例（鎖定於 `test/fixtures/`）

以下案例的期望值由 Python `decimal`（`ROUND_HALF_UP`）依本文件公式獨立算出，
再轉換為分寫入 Dart 測試，作為回歸基準：

- **Fixture A（EMI）**：P=10,000,000 分（TWD 100,000）、MONTHLY、rate=1%
  （100 bps）、n=12、THIRTY_360。
- **Fixture B（EPP）**：P=10,000,007 分（刻意選不整除的本金測試尾差吃法）、
  MONTHLY、rate=1.5%（150 bps）、n=6。
- **Fixture C（IO）**：P=5,000,000 分、MONTHLY、rate=2%（200 bps）、n=4。
- **Fixture D（BULLET）**：P=3,000,000 分、ANNUAL、rate=12%（1200 bps）、
  tenorPeriods=6、periodDays=30（即 180 天）、ACT_365。
- **Fixture E（EMI, r=0）**：P=1,200,000 分、rate=0、n=12（驗證零利率分支）。

詳細逐期金額見 `packages/lending_engine/test/fixtures/*.dart`。
