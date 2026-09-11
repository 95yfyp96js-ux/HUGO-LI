"""展期（丑／BR-022／D05）。

展期＝新契約版本＋新到期日＋同一案件編號＋保留歷史。
展期不得自動把利息滾入本金（民法第 207 條）。
先結清再開新案＝新案件，不是展期（BR-023）。
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy.orm import Session

from . import audit, cases as case_service, compliance, dates, positions, receivable
from .config import Settings, get_settings
from .enums import AuditAction, CaseStatus, ContractSource
from .errors import ErrorCode, SlosError
from .models import Case, ContractVersion, Extension
from .money import money
from .rbac import Actor, require


@dataclass
class ExtensionPreview:
    case_no: str
    old_maturity: dt.date
    new_maturity: dt.date
    new_term_days: int
    carried_principal: Decimal
    outstanding_interest: Decimal
    notes_zh: list[str]
    flags: list[compliance.Flag]


def preview(
    session: Session, case: Case, new_term_days: int, from_date: dt.date | None = None,
    *, capitalize_interest: bool = False, settings: Settings | None = None,
) -> ExtensionPreview:
    cfg = settings or get_settings()
    current = case.current_contract
    start = from_date or current.maturity_date
    dates.validate_term_days(new_term_days, cfg)
    new_maturity = dates.maturity_date(start, new_term_days, cfg)

    view = receivable.compute(session, case, start, settings=cfg)
    notes = [
        "展期沿用同一案件編號，舊契約版本完整保留，不被覆寫（BR-022）。",
        "展期不得自動把利息滾入本金；未收利息仍掛在原分量（D05／民法第 207 條）。",
    ]
    flags = compliance.evaluate(
        receivable.terms_of(current),
        elapsed_days=(new_maturity - current.effective_date).days,
        capitalization_requested=capitalize_interest,
        settings=cfg,
    )
    if capitalize_interest:
        notes.append("要求利息轉本金：系統預設拒絕，必須走調整指令並標記需法律審查。")
    return ExtensionPreview(
        case_no=case.case_no,
        old_maturity=current.maturity_date,
        new_maturity=new_maturity,
        new_term_days=new_term_days,
        carried_principal=view.principal_outstanding,
        outstanding_interest=view.interest_due,
        notes_zh=notes,
        flags=flags,
    )


def extend(
    session: Session,
    actor: Actor,
    case: Case,
    *,
    new_term_days: int,
    from_date: dt.date | None = None,
    capitalize_interest: bool = False,
    settings: Settings | None = None,
) -> tuple[Extension, ContractVersion]:
    require(actor, "EXTEND_REQUEST")
    cfg = settings or get_settings()
    if capitalize_interest:
        # BR-011：禁止自動複利。利息轉本金必須調整指令＋法律審查標記；預設拒絕。
        raise SlosError(
            ErrorCode.E_CAPITALIZATION_FORBIDDEN,
            detail="展期不得把利息滾入本金；請改用 /adjust 並經法律審查。",
        )

    current = case.current_contract
    start = from_date or current.maturity_date
    dates.validate_term_days(new_term_days, cfg)
    carried_principal = positions.principal_outstanding(session, case.id)

    version = case_service.new_version(
        session, actor, case,
        source=ContractSource.EXTENSION.value,
        effective_date=start,
        term_days=new_term_days,
        face_amount=money(carried_principal),
        settings=cfg,
    )
    record = Extension(
        case_id=case.id,
        from_contract_version_id=current.id,
        to_contract_version_id=version.id,
        requested_date=start,
        new_term_days=new_term_days,
        new_maturity_date=version.maturity_date,
        capitalize_interest=False,
        created_by=actor.name,
    )
    session.add(record)
    session.flush()

    if case.status != CaseStatus.EXTENDED.value:
        case_service.set_status(session, actor, case, CaseStatus.EXTENDED, note="展期")
    receivable.snapshot(session, case, start, receivable.TRIGGER_EXTENSION, contract=version)

    audit.record(
        session, actor, AuditAction.EXTEND, "Case", case.case_no,
        detail={
            "from_version": current.version_no,
            "to_version": version.version_no,
            "new_maturity": str(version.maturity_date),
            "carried_principal": str(carried_principal),
            "capitalize_interest": False,
        },
        warning="展期未把利息滾入本金（民法第 207 條）。",
    )
    return record, version
