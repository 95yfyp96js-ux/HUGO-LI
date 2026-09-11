"""沖帳引擎（癸）。

順序：契約覆寫或預設「費用→利息→違約金→本金」，剩餘暫收。
無違約金規則則跳過違約金。
本金不得沖成負數。
每一筆沖帳列必須記下當時規則編號。
付款人指定優先（民法第 321 條；D09 為系統預設，不是法律判決）。
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal

from .config import Settings, get_settings
from .enums import AllocationBucket
from .errors import ErrorCode, SlosError
from .labels import ALLOCATION_BUCKET
from .money import ZERO, money
from .receivable import ReceivableView
from .sentinels import NOT_APPLICABLE, is_sentinel

BUCKET_ORDER_KEYS: dict[str, str] = {
    AllocationBucket.FEE.value: "fee_due",
    AllocationBucket.INTEREST.value: "interest_due",
    AllocationBucket.PENALTY.value: "penalty_due",
    AllocationBucket.PRINCIPAL.value: "principal_outstanding",
}


@dataclass
class AllocationLine:
    bucket: str
    amount: Decimal
    rule_code: str
    source_zh: str  # 「付款人指定」或「系統預設順序」

    @property
    def bucket_zh(self) -> str:
        return ALLOCATION_BUCKET.get(self.bucket, self.bucket)


@dataclass
class AllocationPlan:
    lines: list[AllocationLine]
    rule_code: str
    order_zh: str
    unallocated: Decimal
    notes_zh: list[str]

    @property
    def total(self) -> Decimal:
        return money(sum((line.amount for line in self.lines), ZERO))


def _parse_designation(text: str | None) -> dict[str, Decimal]:
    """付款人指定抵充。格式：{"INTEREST": "500.00", "PRINCIPAL": "1000.00"}"""
    if text is None or is_sentinel(text) or text.strip() in {"", NOT_APPLICABLE}:
        return {}
    try:
        raw = json.loads(text)
    except Exception as exc:  # noqa: BLE001
        raise SlosError(ErrorCode.E_AMOUNT_INVALID, detail="付款人指定格式不正確") from exc
    result: dict[str, Decimal] = {}
    for key, value in raw.items():
        if key not in BUCKET_ORDER_KEYS:
            raise SlosError(ErrorCode.E_PENDING_DECISION, detail=f"未知指定分量 {key}")
        result[key] = money(value)
    return result


def _resolve_order(view: ReceivableView, override: str | None, cfg: Settings) -> tuple[list[str], str]:
    if override and not is_sentinel(override) and override.strip() not in {"", NOT_APPLICABLE}:
        try:
            order = json.loads(override)
        except Exception as exc:  # noqa: BLE001
            raise SlosError(ErrorCode.E_AMOUNT_INVALID, detail="沖帳覆寫格式不正確") from exc
        if not isinstance(order, list) or any(b not in BUCKET_ORDER_KEYS for b in order):
            raise SlosError(ErrorCode.E_PENDING_DECISION, detail="沖帳覆寫內容不合法")
        return list(order), "契約覆寫"
    return list(cfg.allocation_order), cfg.allocation_rule_code


def plan(
    view: ReceivableView,
    amount: Decimal,
    *,
    allocation_override: str | None = None,
    payer_designation: str | None = None,
    settings: Settings | None = None,
) -> AllocationPlan:
    """先預覽再入帳。此函式不寫任何資料。"""
    cfg = settings or get_settings()
    remaining = money(amount)
    if remaining < 0:
        raise SlosError(ErrorCode.E_NEGATIVE_AMOUNT, detail="收款金額不得為負")

    order, order_label = _resolve_order(view, allocation_override, cfg)
    rule_code = cfg.allocation_rule_code
    notes: list[str] = []

    capacity: dict[str, Decimal] = {
        AllocationBucket.FEE.value: money(view.fee_due),
        AllocationBucket.INTEREST.value: money(view.interest_due),
        AllocationBucket.PENALTY.value: money(view.penalty_due),
        AllocationBucket.PRINCIPAL.value: money(view.principal_outstanding),
    }
    if capacity[AllocationBucket.PENALTY.value] == 0:
        notes.append("契約無違約金規則或尚未逾期，跳過違約金分量。")

    lines: list[AllocationLine] = []

    designation = _parse_designation(payer_designation)
    for bucket, wanted in designation.items():
        available = min(remaining, capacity[bucket], money(wanted))
        if available > 0:
            lines.append(AllocationLine(bucket, available, rule_code, "付款人指定"))
            capacity[bucket] = money(capacity[bucket] - available)
            remaining = money(remaining - available)
    if designation:
        notes.append("付款人指定抵充優先（民法第 321 條）。")

    for bucket in order:
        if remaining <= 0:
            break
        available = min(remaining, capacity[bucket])
        if available > 0:
            lines.append(AllocationLine(bucket, available, rule_code, "系統預設順序"))
            capacity[bucket] = money(capacity[bucket] - available)
            remaining = money(remaining - available)

    if remaining > 0:
        lines.append(AllocationLine(
            AllocationBucket.SUSPENSE.value, remaining, rule_code, "系統預設順序"
        ))
        notes.append("超出應收部分進暫收（溢繳），不是收入，也不是負本金（BR-013）。")
        remaining = ZERO

    principal_taken = money(sum(
        (l.amount for l in lines if l.bucket == AllocationBucket.PRINCIPAL.value), ZERO
    ))
    if principal_taken > money(view.principal_outstanding):
        raise SlosError(ErrorCode.E_PRINCIPAL_NEGATIVE, detail=view.case_no)

    notes.append(
        "預設沖帳順序參考民法第 323 條，屬系統設定，不是法律判決；"
        "「費用」是否包含違約金仍待法律審查。"
    )
    return AllocationPlan(
        lines=lines,
        rule_code=rule_code,
        order_zh=order_label,
        unallocated=remaining,
        notes_zh=notes,
    )
