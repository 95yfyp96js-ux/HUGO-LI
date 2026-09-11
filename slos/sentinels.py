"""哨兵詞。

規格：〇-6　未知資料只能存 MISSING／UNKNOWN／N/A／PENDING／NOT_VERIFIED。
禁止用 0 或空白代替未知。
規格：BR-027　證據編號不得空字串，必須是哨兵詞或真實編號。
"""
from __future__ import annotations

from .errors import SlosError, ErrorCode

MISSING = "MISSING"          # 缺：應該有但沒拿到
UNKNOWN = "UNKNOWN"          # 有但尚未辨識
NOT_APPLICABLE = "N/A"       # 不適用
PENDING = "PENDING"          # 流程未完
NOT_VERIFIED = "NOT_VERIFIED"  # 未核驗

SENTINELS: frozenset[str] = frozenset({MISSING, UNKNOWN, NOT_APPLICABLE, PENDING, NOT_VERIFIED})

LABELS_ZH_HANT: dict[str, str] = {
    MISSING: "缺",
    UNKNOWN: "有但尚未辨識",
    NOT_APPLICABLE: "不適用",
    PENDING: "流程未完",
    NOT_VERIFIED: "未核驗",
}


def is_sentinel(value: str | None) -> bool:
    return value in SENTINELS


def require_text_or_sentinel(value: str | None, field: str) -> str:
    """文字欄位不得空白，必須是真實內容或哨兵詞。"""
    if value is None:
        raise SlosError(ErrorCode.E_SENTINEL_REQUIRED, detail=f"{field} 為 None")
    text = value.strip()
    if text == "":
        raise SlosError(ErrorCode.E_SENTINEL_REQUIRED, detail=f"{field} 為空字串")
    return text


def require_evidence_ref(value: str | None, field: str = "證據編號") -> str:
    """哨兵詞與真實流水存在同一文字欄，不得空白。"""
    if value is None or value.strip() == "":
        raise SlosError(ErrorCode.E_EVIDENCE_REF_EMPTY, detail=field)
    return value.strip()


def display(value: str | None) -> str:
    """畫面顯示：哨兵詞轉成繁中說明。"""
    if value is None:
        return LABELS_ZH_HANT[MISSING]
    if value in LABELS_ZH_HANT:
        return LABELS_ZH_HANT[value]
    return value
