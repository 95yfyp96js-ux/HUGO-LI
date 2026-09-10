"""角色與權限（乙）。V1 允許同一人操作與覆核，但寫警告稽核（D08／BR-029）。"""
from __future__ import annotations

from dataclasses import dataclass

from .enums import Role
from .errors import ErrorCode, SlosError

# 權限代碼（英文）→ 繁中說明
PERMISSIONS: dict[str, str] = {
    "INTAKE": "進件",
    "DISBURSE": "撥款",
    "COLLECT": "收款",
    "EXTEND_REQUEST": "申請展期",
    "SETTLE_QUOTE": "結清試算",
    "ATTACH_EVIDENCE": "附上證據",
    "ALLOCATE_CONFIRM": "確認沖帳",
    "RECONCILE": "對帳",
    "DAY_CLOSE": "日結",
    "MONTH_CLOSE": "月結",
    "ADJUST": "調整",
    "READ_MASKED": "遮蔽後查詢",
    "READ_AUDIT": "稽核紀錄",
    "CONTROL_CHECK": "控制檢查",
    "PERIOD_REOPEN": "重開帳期",
    "WRITEOFF_APPROVE": "核准核銷",
    "VIEW_FULL_PII": "看完整個資",
    "EXPORT_FULL": "完整匯出",
    "SETTINGS_CHANGE": "改設定",
}

ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    Role.ADMIN.value: frozenset(PERMISSIONS),
    Role.OPERATOR.value: frozenset({
        "INTAKE", "DISBURSE", "COLLECT", "EXTEND_REQUEST", "SETTLE_QUOTE",
        "ATTACH_EVIDENCE", "READ_MASKED",
    }),
    Role.ACCOUNTING.value: frozenset({
        "ALLOCATE_CONFIRM", "RECONCILE", "DAY_CLOSE", "MONTH_CLOSE", "ADJUST",
        "READ_MASKED", "COLLECT",
    }),
    Role.READONLY.value: frozenset({"READ_MASKED"}),
    Role.AUDITOR.value: frozenset({"READ_MASKED", "READ_AUDIT", "CONTROL_CHECK"}),
}


@dataclass(frozen=True)
class Actor:
    """操作者。V1 單人模式常見，稽核仍逐筆記名。"""

    name: str
    role: str

    def has(self, permission: str) -> bool:
        return permission in ROLE_PERMISSIONS.get(self.role, frozenset())


def require(actor: Actor, permission: str) -> None:
    if permission not in PERMISSIONS:
        raise SlosError(ErrorCode.E_PERMISSION_DENIED, detail=f"未知權限 {permission}")
    if not actor.has(permission):
        raise SlosError(
            ErrorCode.E_PERMISSION_DENIED,
            detail=f"{actor.name}（{actor.role}）缺少「{PERMISSIONS[permission]}」權限",
        )
