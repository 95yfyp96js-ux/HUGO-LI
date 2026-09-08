# 狀態機

## 1. 貸款狀態（`LoanStatus`，完整列舉）

```
DRAFT
  → PENDING_DECISION
PENDING_DECISION
  → APPROVED_CONDITIONAL
  → CANCELLED
APPROVED_CONDITIONAL
  → OFFERED
  → CANCELLED
OFFERED
  → ACCEPTED
  → CANCELLED
ACCEPTED
  → DISBURSED
  → CANCELLED
DISBURSED
  → CURRENT
CURRENT
  → DELINQUENT
  → SETTLED
DELINQUENT
  → CURRENT   （補繳到不再逾期）
  → DEFAULT
  → SETTLED
DEFAULT
  → CHARGED_OFF
  → SETTLED   （事後全額清償）
SETTLED / CHARGED_OFF / CANCELLED
  （終態，不可再轉移）
```

第一版 UI 精簡呈現為 4 種可見狀態，但底層 enum 與轉移函式完整實作：

- UI「草稿 DRAFT」= `DRAFT | PENDING_DECISION | APPROVED_CONDITIONAL | OFFERED | ACCEPTED`
  （尚未撥款，皆可編輯條件）。
- UI「進行中 CURRENT」= `DISBURSED | CURRENT`。
- UI「逾期 DELINQUENT」= `DELINQUENT | DEFAULT`。
- UI「結案」= `SETTLED | CHARGED_OFF | CANCELLED`。

### 1.1 觸發事件

| 轉移 | 觸發 |
|---|---|
| `DRAFT → PENDING_DECISION` | 借款人／貸款資料填寫完成，送出 |
| `PENDING_DECISION → APPROVED_CONDITIONAL` | 出借人核決（人工，系統僅提供建議，見下） |
| `APPROVED_CONDITIONAL → OFFERED` | 產生正式條件書 |
| `OFFERED → ACCEPTED` | 借款人接受條件 |
| `ACCEPTED → DISBURSED` | 使用者按下「確認撥款」，寫入 `DISBURSEMENT` 分錄，`disbursedAt` 定案，開始計息 |
| `DISBURSED → CURRENT` | 撥款日結完成，進入正常還款狀態（可與上一步同一動作） |
| `CURRENT → DELINQUENT` | 任一期 `dueDate + graceDays < today` 且未全額繳清 |
| `DELINQUENT → CURRENT` | 逾期金額全數補繳 |
| `DELINQUENT → DEFAULT` | 逾期超過設定門檻（預設 90 天） |
| `* → SETTLED` | 剩餘本金與利息全數結清（`balance == 0`） |
| `DEFAULT → CHARGED_OFF` | 出借人手動認列呆帳 |
| `DRAFT..ACCEPTED → CANCELLED` | 撥款前任一時點可取消 |

系統**永不自動核准貸款**。若啟用核貸建議模組，只輸出五種建議之一，寫入
`loan_events`，不直接改變 `LoanStatus`：

```
APPROVE_RECOMMEND | REFER | REQUEST_INFO | DECLINE_RECOMMEND | ESCALATE_FRAUD
```

由人工依建議手動操作 `PENDING_DECISION → APPROVED_CONDITIONAL`（或 `CANCELLED`）。

## 2. 期別狀態（`ScheduleItemStatus`）

```
DUE       初始，尚未到期或到期未繳
  → PAID       全額繳清
  → PARTIAL    部分繳款
  → PREPAID    提前全額繳清（早於 dueDate）
  → OVERDUE    dueDate + graceDays < today 且未全額繳清
  → WAIVED     出借人手動減免（需 loan_event 記錄原因）

PARTIAL → PAID | OVERDUE
OVERDUE → PARTIAL | PAID
```

`PAID` / `PREPAID` / `WAIVED` 為終態（該期不再變動；後續修正一律用調整分錄）。

## 3. 授權（License）狀態

```
TRIAL(remaining=10) → TRIAL(remaining=N-1) ... → TRIAL_EXHAUSTED
TRIAL_EXHAUSTED → LICENSED   （輸入有效授權碼並通過裝置綁定驗證）
TRIAL(any) → LICENSED        （提前輸入授權碼）
LICENSED → LICENSED          （終態，不可逆回試用）
```

`TRIAL_EXHAUSTED` 時：唯讀操作（瀏覽、報表、匯出）仍可用；「新增貸款」與
「確認撥款」兩個計入次數的寫入動作被鎖定，導向設定頁輸入授權碼。
