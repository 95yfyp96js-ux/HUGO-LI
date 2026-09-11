"""錯誤碼（英文）與使用者說明（繁體中文）。

規格：午　錯誤碼可英文，對使用者說明必須繁中。
"""
from __future__ import annotations

from enum import Enum


class ErrorCode(str, Enum):
    E_FLOAT_FORBIDDEN = "E_FLOAT_FORBIDDEN"
    E_AMOUNT_INVALID = "E_AMOUNT_INVALID"
    E_NEGATIVE_AMOUNT = "E_NEGATIVE_AMOUNT"
    E_MISSING_VALUE = "E_MISSING_VALUE"
    E_SENTINEL_REQUIRED = "E_SENTINEL_REQUIRED"
    E_EVIDENCE_REF_EMPTY = "E_EVIDENCE_REF_EMPTY"
    E_IMMUTABLE_POSTED = "E_IMMUTABLE_POSTED"
    E_DELETE_FORBIDDEN = "E_DELETE_FORBIDDEN"
    E_AUDIT_IMMUTABLE = "E_AUDIT_IMMUTABLE"
    E_UNBALANCED_ENTRY = "E_UNBALANCED_ENTRY"
    E_DUPLICATE_IDEMPOTENCY = "E_DUPLICATE_IDEMPOTENCY"
    E_IDEMPOTENCY_KEY_REQUIRED = "E_IDEMPOTENCY_KEY_REQUIRED"
    E_PERIOD_CLOSED = "E_PERIOD_CLOSED"
    E_PERIOD_REOPEN_REASON_REQUIRED = "E_PERIOD_REOPEN_REASON_REQUIRED"
    E_PERMISSION_DENIED = "E_PERMISSION_DENIED"
    E_INVALID_TERM_DAYS = "E_INVALID_TERM_DAYS"
    E_TERM_DAYS_TOO_LONG = "E_TERM_DAYS_TOO_LONG"
    E_CUSTOM_FORMULA_UNSUPPORTED = "E_CUSTOM_FORMULA_UNSUPPORTED"
    E_CAPITALIZATION_FORBIDDEN = "E_CAPITALIZATION_FORBIDDEN"
    E_INTEREST_ON_INTEREST_FORBIDDEN = "E_INTEREST_ON_INTEREST_FORBIDDEN"
    E_AUTO_MATCH_FORBIDDEN = "E_AUTO_MATCH_FORBIDDEN"
    E_NO_CASE_REFERENCE = "E_NO_CASE_REFERENCE"
    E_PRINCIPAL_NEGATIVE = "E_PRINCIPAL_NEGATIVE"
    E_SPEC_CONFLICT = "E_SPEC_CONFLICT"
    E_PENDING_DECISION = "E_PENDING_DECISION"
    E_CURRENCY_NOT_SUPPORTED = "E_CURRENCY_NOT_SUPPORTED"
    E_STATE_TRANSITION = "E_STATE_TRANSITION"
    E_CONTRACT_FIELD_LOCKED = "E_CONTRACT_FIELD_LOCKED"
    E_NOT_AN_APPROVAL_SYSTEM = "E_NOT_AN_APPROVAL_SYSTEM"
    E_FORBIDDEN_FEATURE = "E_FORBIDDEN_FEATURE"
    E_ALREADY_REVERSED = "E_ALREADY_REVERSED"
    E_NOT_POSTED = "E_NOT_POSTED"
    E_QUOTE_EXPIRED = "E_QUOTE_EXPIRED"
    E_SETTLEMENT_NOT_QUOTED = "E_SETTLEMENT_NOT_QUOTED"
    E_ADJUSTMENT_LIMIT = "E_ADJUSTMENT_LIMIT"
    E_UNKNOWN_ACCOUNT = "E_UNKNOWN_ACCOUNT"
    E_CASE_NOT_FOUND = "E_CASE_NOT_FOUND"
    E_CONTRACT_NOT_FOUND = "E_CONTRACT_NOT_FOUND"
    E_SPECIAL_CATEGORY_PII = "E_SPECIAL_CATEGORY_PII"


MESSAGES_ZH_HANT: dict[ErrorCode, str] = {
    ErrorCode.E_FLOAT_FORBIDDEN: "金額不得使用浮點數。請改用字串或 Decimal。",
    ErrorCode.E_AMOUNT_INVALID: "金額格式不正確。",
    ErrorCode.E_NEGATIVE_AMOUNT: "金額不得為負數。",
    ErrorCode.E_MISSING_VALUE: "必填欄位缺值。未知資料請填 MISSING／UNKNOWN／N/A／PENDING／NOT_VERIFIED，不得留白或填 0。",
    ErrorCode.E_SENTINEL_REQUIRED: "此欄位不得空白。請填真實內容或哨兵詞。",
    ErrorCode.E_EVIDENCE_REF_EMPTY: "證據編號不得為空字串。沒有流水請填 MISSING。",
    ErrorCode.E_IMMUTABLE_POSTED: "已入帳資料不得修改。請改用沖正加更正。",
    ErrorCode.E_DELETE_FORBIDDEN: "本系統不允許刪除交易或稽核紀錄。",
    ErrorCode.E_AUDIT_IMMUTABLE: "稽核紀錄不得修改或刪除。",
    ErrorCode.E_UNBALANCED_ENTRY: "借貸不平衡，不得入帳。",
    ErrorCode.E_DUPLICATE_IDEMPOTENCY: "相同冪等鍵已入帳，不會重複記帳。",
    ErrorCode.E_IDEMPOTENCY_KEY_REQUIRED: "會動到錢的操作必須帶冪等鍵。",
    ErrorCode.E_PERIOD_CLOSED: "該月份已關帳，不得入帳。需管理員重開帳期並填寫原因。",
    ErrorCode.E_PERIOD_REOPEN_REASON_REQUIRED: "重開帳期必須填寫原因。",
    ErrorCode.E_PERMISSION_DENIED: "權限不足，無法執行此操作。",
    ErrorCode.E_INVALID_TERM_DAYS: "借款天數必須介於 1 至 365 天。",
    ErrorCode.E_TERM_DAYS_TOO_LONG: "借款天數超過 365 天，本系統拒絕建立。",
    ErrorCode.E_CUSTOM_FORMULA_UNSUPPORTED: "V1 不支援自訂計息公式。",
    ErrorCode.E_CAPITALIZATION_FORBIDDEN: "不得自動把利息滾入本金。需走調整指令並標記需法律審查。",
    ErrorCode.E_INTEREST_ON_INTEREST_FORBIDDEN: "不得對利息再計息。",
    ErrorCode.E_AUTO_MATCH_FORBIDDEN: "不得只靠金額自動配對案件或自動標示已配。",
    ErrorCode.E_NO_CASE_REFERENCE: "沒有案件編號，只能掛暫收「無法認列」。",
    ErrorCode.E_PRINCIPAL_NEGATIVE: "本金不得沖成負數。",
    ErrorCode.E_SPEC_CONFLICT: "待決策／規格衝突：本功能停止，不得自行推測。",
    ErrorCode.E_PENDING_DECISION: "待決策：規格缺值，本功能停止。",
    ErrorCode.E_CURRENCY_NOT_SUPPORTED: "V1 入帳幣別僅支援 TWD。",
    ErrorCode.E_STATE_TRANSITION: "狀態轉換不合法。",
    ErrorCode.E_CONTRACT_FIELD_LOCKED: "契約關鍵欄位不得就地修改，請建立新的契約版本。",
    ErrorCode.E_NOT_AN_APPROVAL_SYSTEM: "本系統永不核貸，沒有核准狀態。",
    ErrorCode.E_FORBIDDEN_FEATURE: "V1 禁止此功能（投資人、資金池、募資、分潤、評分、鑑價、法律意見）。",
    ErrorCode.E_ALREADY_REVERSED: "該筆交易已沖正，不得重複沖正。",
    ErrorCode.E_NOT_POSTED: "該筆交易尚未入帳。",
    ErrorCode.E_QUOTE_EXPIRED: "結清報價已過期，請重新試算。",
    ErrorCode.E_SETTLEMENT_NOT_QUOTED: "結清入帳前必須先做結清試算。",
    ErrorCode.E_ADJUSTMENT_LIMIT: "調整金額超過單筆上限，需管理員核准。",
    ErrorCode.E_UNKNOWN_ACCOUNT: "科目代碼不存在。",
    ErrorCode.E_CASE_NOT_FOUND: "查無此案件。",
    ErrorCode.E_CONTRACT_NOT_FOUND: "查無目前契約版本。",
    ErrorCode.E_SPECIAL_CATEGORY_PII: "禁止蒐集個資法第 6 條特種個人資料。",
}


class SlosError(Exception):
    """對使用者一律回繁體中文說明，對機器保留英文錯誤碼。"""

    def __init__(self, code: ErrorCode, detail: str | None = None):
        self.code = code
        self.detail = detail
        self.message_zh = MESSAGES_ZH_HANT.get(code, "系統發生未預期錯誤。")
        text = f"[{code.value}] {self.message_zh}"
        if detail:
            text = f"{text}（{detail}）"
        super().__init__(text)

    def as_dict(self) -> dict[str, str | None]:
        return {"code": self.code.value, "message": self.message_zh, "detail": self.detail}


class SpecConflict(SlosError):
    """規格自相矛盾時必須停止，標記待決策／規格衝突，不准猜。"""

    def __init__(self, detail: str):
        super().__init__(ErrorCode.E_SPEC_CONFLICT, detail)
