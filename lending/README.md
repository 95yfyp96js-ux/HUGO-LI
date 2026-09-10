# 民間短期小額借款作業系統 V1.4

規格編號：`SLOS-V1.4-LOCKED`　規格全文：[docs/SPEC_V1.4_LOCKED.zhHant.md](docs/SPEC_V1.4_LOCKED.zhHant.md)

畫面、說明、錯誤訊息、Excel 表頭、指令說明一律繁體中文。
資料庫欄位名、API 路徑、列舉代碼維持英文（機器識別）。

## 這套系統不做什麼

- **不核貸。** 建立案件不是核准貸款，資料模型裡沒有核准狀態欄。
- **不募資。** 資金來源寫死出借人自有資金，沒有投資人、資金池、分潤、群眾募資的資料表或欄位。
- **不產出法律意見。** 系統只會打作業旗標，不宣告契約無效、不認定重利、不代替律師判斷。

以上三件事在程式層被擋住，不是靠文件約束：
`slos/cases.py` 的 `reject_forbidden_input()` 會拒收核准、評分、投資人、募資、分潤等欄位；
`slos/compliance.py` 只產旗標與「需法律審查」清單。

## 系統核心不寫死利率

`BR-019`：利率用類型欄位保存，系統核心不得寫死任何利率數字。

- 契約利率存在 `contract_versions.rate_value / rate_unit / interest_method`。
- 民法第 203、204、205 條的門檻是**設定檔參數**，放在 `config/settings.default.json` 的 `statutory` 區塊，不是程式碼裡的字面量。
- 示範案利率預設 `0`，是參數不是規則（D13）。
- 計息引擎 `slos/interest.py`、合規模組 `slos/compliance.py` 內沒有任何利率字面量，一律向設定檔取值。

要改門檻，改設定檔或用環境變數 `SLOS_SETTINGS` 指向自己的檔案，不必動程式。

## 安裝

```bash
pip install -r requirements.txt
export SLOS_DATABASE_URL="sqlite+pysqlite:///slos.db"
python3 -m alembic upgrade head
```

## 指令（斜線指令保留英文便於複製，說明繁中）

```bash
python3 -m slos.cli /help          # 列出全部指令與進件表單
python3 -m slos.cli /demo          # 建立示範案 L20260911-001（30 天，利率為參數）
```

| 指令 | 用途 |
|---|---|
| `/intake` | 進件。建立客戶、案件與第 1 版契約。 |
| `/disburse` | 撥款。帳上本金以實撥為準。 |
| `/collect` | 收款。先預覽沖帳，加 `--confirm` 才入帳。 |
| `/settle` | 結清。試算與入帳分開。 |
| `/extend` | 展期。新契約版本，不覆寫舊約，不滾息。 |
| `/adjust` `/reverse` `/writeoff` | 調整、沖正、核銷。 |
| `/recon` | 對帳。流水＋金額＋方向＋日期正負兩天。 |
| `/aging` `/stmt` `/case` `/dash` `/check` | 帳齡、對帳單、案件頁、儀表板、控制檢查。 |
| `/dayclose` `/monthclose` | 日結、月結（含重開帳期）。 |
| `/export` | 匯出 Excel，預設遮蔽版。 |

每個會動錢的指令都走：檢核 → 預覽 → 確認（`--confirm`）→ 入帳 → 結果 → 稽核 → 錯誤。
不加 `--confirm` 只會預覽，不會入帳。

範例：

```bash
python3 -m slos.cli /intake --borrower "借款人甲" --principal 50000.00 \
  --days 30 --rate 0.15 --rate-unit ANNUAL --method ACT_365 --date 2026-09-11
python3 -m slos.cli /disburse --case L20260911-001 --amount 50000.00 \
  --date 2026-09-11 --key DISB-001 --confirm
python3 -m slos.cli /collect --case L20260911-001 --amount 20000.00 \
  --date 2026-09-21 --key RCPT-001            # 先看沖帳預覽
python3 -m slos.cli /collect --case L20260911-001 --amount 20000.00 \
  --date 2026-09-21 --key RCPT-001 --confirm  # 再入帳
```

## 帳本規則

- 金額唯一真相是資料庫裡**只能追加**的帳本。Excel 只做輸入、核對、匯出，不是帳本，也不是備份。
- 金額一律 `Decimal`，以文字保存（`50000.00`）。程式層拒收 `float`。
- 已入帳交易不得 UPDATE、不得 DELETE。要改只能沖正加更正。
- 每筆入帳都有借貸分錄，不平衡不得入帳。
- 同一帳本＋同一冪等鍵不會重複入帳。
- 未知資料只能填 `MISSING`／`UNKNOWN`／`N/A`／`PENDING`／`NOT_VERIFIED`，不得用 0 或空白。

## 測試

```bash
python3 -m pytest              # 全部
python3 -m pytest -m p0        # 階段門檻測試
```

目前：104 個測試，其中 73 個標記 `p0`。下一階段開始前 `p0` 必須全過。

## 施工階段狀態

| 階段 | 內容 | 狀態 |
|---|---|---|
| 0 | 基礎（金額型別、哨兵、錯誤碼） | 完成 |
| 1 | 資料庫（22 張表 + Alembic） | 完成 |
| 2 | 帳本（分錄、冪等、不可變、帳期） | 完成 |
| 3 | 計息／應收 | 完成 |
| 4 | 收款／沖帳 | 完成 |
| 5 | 撥款 | 完成 |
| 6 | 結清／展期 | 完成 |
| 7 | 對帳 | 完成 |
| 8 | 資安／稽核（角色、個資遮蔽、稽核不可竄改） | 完成 |
| 9 | Excel（14 張繁中表 + 15_指令） | 完成 |
| 10 | 儀表板（指令列版） | 完成 |
| 11 | 指令 | 完成 |
| 12 | 測試 | 完成 |
| 13 | 上線加固（FastAPI、Postgres、備份排程、傳輸加密） | **未做** |

階段 13 未做的具體項目見 [docs/驗收與追溯.md](docs/驗收與追溯.md) 末段。

## 法律聲明

本系統只產生作業旗標，不產生法律意見、不核貸、不認定契約效力。
涉及法律效果的判斷（日息折年、費用是否構成巧取利益、是否需特許、是否構成重利、
民法第 323 條「費用」是否包含違約金），一律交由律師處理。
