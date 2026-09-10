"""應收引擎（辛）。只在事件落地快照，不做每天排程產快照。

BR-007　到期應收＝未償本金＋未收利息＋契約費用＋契約違約金。不得自創費用。
BR-008　基準日晚於到期日且應收大於容差：狀態＝逾期。
BR-009　到期後遲延利息僅在契約有規則時才算。
BR-010　禁止對利息再計息。
"""
from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy.orm import Session

from . import compliance, dates, ledger, positions
from .config import Settings, get_settings
from .enums import AllocationBucket
from .interest import InterestTerms, compute as compute_interest
from .models import Case, ContractVersion, ReceivableSnapshot
from .money import D, ZERO, money
from .sentinels import NOT_APPLICABLE, PENDING, is_sentinel

TRIGGER_DISBURSE = "DISBURSE"
TRIGGER_PARTIAL_REPAY = "PARTIAL_REPAY"
TRIGGER_MATURITY = "MATURITY"
TRIGGER_EXTENSION = "EXTENSION"
TRIGGER_SETTLE_QUOTE = "SETTLE_QUOTE"
TRIGGER_DAY_CLOSE = "DAY_CLOSE"

TRIGGER_LABELS_ZH: dict[str, str] = {
    TRIGGER_DISBURSE: "撥款",
    TRIGGER_PARTIAL_REPAY: "部分還",
    TRIGGER_MATURITY: "到期",
    TRIGGER_EXTENSION: "展期",
    TRIGGER_SETTLE_QUOTE: "結清試算",
    TRIGGER_DAY_CLOSE: "日結",
}


@dataclass
class ReceivableView:
    case_no: str
    as_of_date: dt.date
    maturity_date: dt.date
    overdue_days: int
    principal_outstanding: Decimal
    interest_contract: Decimal
    interest_enforceable: Decimal
    interest_received: Decimal
    interest_due: Decimal
    fee_due: Decimal
    penalty_due: Decimal
    total_due: Decimal
    is_overdue: bool
    late_interest_state: str          # N/A 或 PENDING（規則需人工計算）
    interest_breakdown: list[str] = field(default_factory=list)
    warnings_zh: list[str] = field(default_factory=list)
    flags: list[compliance.Flag] = field(default_factory=list)


def terms_of(contract: ContractVersion) -> InterestTerms:
    return InterestTerms(
        principal_original=D(contract.face_amount),
        term_days=contract.term_days,
        rate_value=D(contract.rate_value),
        rate_unit=contract.rate_unit,
        interest_method=contract.interest_method,
        period_flat_amount=contract.period_flat_amount,
        sticky_interest=contract.sticky_interest,
        rate_type=contract.rate_type,
    )


def _has_rule(text: str | None) -> bool:
    if text is None:
        return False
    value = text.strip()
    return value != "" and value != NOT_APPLICABLE and not is_sentinel(value) and value != "無"


def _late_interest_state(contract: ContractVersion, overdue: int) -> tuple[str, list[str]]:
    """BR-009：契約沒有遲延利息規則就不算；有但無法機器解析則標 PENDING，不填 0。"""
    if overdue <= 0 or not _has_rule(contract.late_interest_rule):
        return NOT_APPLICABLE, []
    try:
        json.loads(contract.late_interest_rule)
    except Exception:  # noqa: BLE001
        return PENDING, [
            "契約載有遲延利息規則，但非機器可解析格式，本次未計入應收。"
            "請人工計算或改以結構化規則登錄（待決策）。"
        ]
    return PENDING, [
        "契約載有遲延利息規則。V1 不自動計算遲延利息，請人工核算後以調整指令入帳。"
        "依民法第 233 條第 2 項，對利息不得再計遲延利息。"
    ]


def compute(
    session: Session,
    case: Case,
    as_of: dt.date,
    *,
    contract: ContractVersion | None = None,
    settings: Settings | None = None,
    entry_cutoff_id: int | None = None,
) -> ReceivableView:
    """算出基準日的應收。

    entry_cutoff_id 是傳票序號切點：同一天內先後順序靠它還原，
    快照才能被逐筆重算核對（辛）。
    """
    cfg = settings or get_settings()
    version = contract or case.current_contract
    terms = terms_of(version)

    segments = positions.principal_segments(
        session, case, version, as_of, entry_cutoff_id=entry_cutoff_id
    )
    interest = compute_interest(
        terms, segments,
        effective_date=version.effective_date,
        maturity_date=version.maturity_date,
        settings=cfg,
    )

    principal_out = positions.principal_outstanding(
        session, case.id, as_of=as_of, entry_cutoff_id=entry_cutoff_id)
    interest_received = positions.allocated_total(
        session, case.id, AllocationBucket.INTEREST, as_of=as_of,
        entry_cutoff_id=entry_cutoff_id)
    fee_received = positions.allocated_total(
        session, case.id, AllocationBucket.FEE, as_of=as_of,
        entry_cutoff_id=entry_cutoff_id)
    penalty_received = positions.allocated_total(
        session, case.id, AllocationBucket.PENALTY, as_of=as_of,
        entry_cutoff_id=entry_cutoff_id)

    interest_due = money(max(interest.enforceable_amount - interest_received, ZERO))
    fee_due = money(max(D(version.fee_amount) - fee_received, ZERO))

    overdue = dates.overdue_days(version.maturity_date, as_of)
    penalty_due = ZERO
    if _has_rule(version.penalty_rule) and overdue > 0:
        penalty_due = money(max(D(version.penalty_amount) - penalty_received, ZERO))

    total_due = money(principal_out + interest_due + fee_due + penalty_due)
    is_overdue = overdue > 0 and total_due > cfg.amount_tolerance

    late_state, warnings = _late_interest_state(version, overdue)

    flags = compliance.evaluate(
        terms,
        elapsed_days=(as_of - version.effective_date).days,
        fee_amount=D(version.fee_amount),
        has_penalty_rule=_has_rule(version.penalty_rule),
        evidence_ref=version.contract_ref,
        settings=cfg,
    )
    if interest.capped:
        warnings.append(
            "推估年利率逾設定檔上限，超額部分未認列為可執行利息收入；契約原額已完整保存。"
        )

    return ReceivableView(
        case_no=case.case_no,
        as_of_date=as_of,
        maturity_date=version.maturity_date,
        overdue_days=overdue,
        principal_outstanding=principal_out,
        interest_contract=interest.contract_amount,
        interest_enforceable=interest.enforceable_amount,
        interest_received=interest_received,
        interest_due=interest_due,
        fee_due=fee_due,
        penalty_due=penalty_due,
        total_due=total_due,
        is_overdue=is_overdue,
        late_interest_state=late_state,
        interest_breakdown=interest.breakdown,
        warnings_zh=warnings,
        flags=flags,
    )


def snapshot(
    session: Session,
    case: Case,
    as_of: dt.date,
    trigger: str,
    *,
    contract: ContractVersion | None = None,
    settings: Settings | None = None,
) -> ReceivableSnapshot:
    """事件落地快照。必須能重算核對上一張快照。"""
    version = contract or case.current_contract
    cutoff = ledger.max_entry_id(session)
    view = compute(
        session, case, as_of, contract=version, settings=settings, entry_cutoff_id=cutoff
    )
    record = ReceivableSnapshot(
        case_id=case.id,
        entry_cutoff_id=cutoff,
        contract_version_id=version.id,
        as_of_date=as_of,
        trigger_event=trigger,
        principal_outstanding=view.principal_outstanding,
        interest_contract=view.interest_contract,
        interest_enforceable=view.interest_enforceable,
        interest_received=view.interest_received,
        interest_due=view.interest_due,
        fee_due=view.fee_due,
        penalty_due=view.penalty_due,
        total_due=view.total_due,
        overdue_days=view.overdue_days,
        flags=json.dumps(
            [f.code for f in view.flags], ensure_ascii=False
        ) if view.flags else NOT_APPLICABLE,
    )
    session.add(record)
    session.flush()
    return record


def replay_matches(
    session: Session, case: Case, record: ReceivableSnapshot
) -> tuple[bool, str]:
    """重算核對上一張快照（辛）。"""
    version = session.get(ContractVersion, record.contract_version_id)
    view = compute(
        session, case, record.as_of_date, contract=version,
        entry_cutoff_id=record.entry_cutoff_id,
    )
    same = (
        view.principal_outstanding == D(record.principal_outstanding)
        and view.interest_due == D(record.interest_due)
        and view.total_due == D(record.total_due)
    )
    if same:
        return True, "重算結果與快照一致。"
    return False, (
        f"重算不一致：本金 {view.principal_outstanding} vs {record.principal_outstanding}，"
        f"利息 {view.interest_due} vs {record.interest_due}，"
        f"合計 {view.total_due} vs {record.total_due}。"
    )
