"""個資遮蔽（寅）。預設遮蔽，看完整個資與完整匯出必須管理員並寫稽核。

身分證：A123****89　電話：09**-***678　帳號：********1234　地址：只留區級。
禁止在資料模型收病歷、犯罪前科等個資法第 6 條特種資料。
"""
from __future__ import annotations

import re

from sqlalchemy.orm import Session

from .enums import AuditAction, Role
from .errors import ErrorCode, SlosError
from .rbac import Actor, require
from .sentinels import is_sentinel
from . import audit

#: 個資法第 6 條特種個人資料。本系統禁止蒐集。
SPECIAL_CATEGORY_KEYWORDS: tuple[str, ...] = (
    "病歷", "醫療", "基因", "性生活", "健康檢查", "犯罪前科", "前科",
)

_ADMIN_DIVISION = re.compile(r"^(.{2,4}?[市縣])(.{1,4}?[區鄉鎮市])")


def _keep(value: str | None) -> bool:
    return value is None or is_sentinel(value) or value.strip() == ""


def mask_national_id(value: str | None) -> str:
    """A123456789 → A123****89"""
    if _keep(value):
        return value or "MISSING"
    text = value.strip()
    if len(text) <= 6:
        return text[0] + "*" * (len(text) - 1) if text else "MISSING"
    return f"{text[:4]}{'*' * (len(text) - 6)}{text[-2:]}"


def mask_phone(value: str | None) -> str:
    """0912345678 → 09**-***678"""
    if _keep(value):
        return value or "MISSING"
    digits = re.sub(r"\D", "", value)
    if len(digits) < 6:
        return "*" * len(digits)
    head = digits[:2]
    tail = digits[-3:]
    middle = len(digits) - 5
    return f"{head}{'*' * min(middle, 2)}-{'*' * max(middle - 2, 0)}{tail}"


def mask_account(value: str | None) -> str:
    """1234567890 → ********7890"""
    if _keep(value):
        return value or "MISSING"
    text = re.sub(r"\s", "", value.strip())
    if len(text) <= 4:
        return "*" * len(text)
    return f"{'*' * (len(text) - 4)}{text[-4:]}"


def mask_address(value: str | None) -> str:
    """只留區級，路名以後遮蔽。"""
    if _keep(value):
        return value or "MISSING"
    text = value.strip()
    matched = _ADMIN_DIVISION.match(text)
    if matched:
        return f"{matched.group(1)}{matched.group(2)}（以下遮蔽）"
    return "（地址已遮蔽）"


def mask_name(value: str | None) -> str:
    """姓名：保留第一個字，其餘遮蔽。"""
    if _keep(value):
        return value or "MISSING"
    text = value.strip()
    if len(text) <= 1:
        return text
    return f"{text[0]}{'○' * (len(text) - 1)}"


def reject_special_category(payload: dict[str, object]) -> None:
    """禁止在資料模型收特種資料。"""
    blob = " ".join(f"{k} {v}" for k, v in payload.items())
    hit = [word for word in SPECIAL_CATEGORY_KEYWORDS if word in blob]
    if hit:
        raise SlosError(ErrorCode.E_SPECIAL_CATEGORY_PII, detail=f"偵測到 {hit}")


def customer_view(customer, *, masked: bool = True) -> dict[str, str]:
    """畫面預設遮蔽版。"""
    if masked:
        return {
            "客戶編號": customer.customer_no,
            "姓名": mask_name(customer.name),
            "身分證": mask_national_id(customer.national_id),
            "電話": mask_phone(customer.phone),
            "地址": mask_address(customer.address),
            "帳號": mask_account(customer.bank_account),
        }
    return {
        "客戶編號": customer.customer_no,
        "姓名": customer.name,
        "身分證": customer.national_id,
        "電話": customer.phone,
        "地址": customer.address,
        "帳號": customer.bank_account,
    }


def reveal(session: Session, actor: Actor, customer) -> dict[str, str]:
    """看完整個資：必須管理員（或明示授權），且一定寫稽核。"""
    require(actor, "VIEW_FULL_PII")
    if actor.role != Role.ADMIN.value:
        raise SlosError(ErrorCode.E_PERMISSION_DENIED, detail="看完整個資須系統管理員")
    audit.record(
        session, actor, AuditAction.VIEW_FULL_PII, "Customer", customer.customer_no,
        detail={"legal_basis": "個資法第 19、20 條：契約關係內之特定目的必要範圍。"},
    )
    return customer_view(customer, masked=False)
