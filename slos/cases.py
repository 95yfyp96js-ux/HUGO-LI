"""進件與契約版本。

BR-001　建立案件不是核貸。沒有核准狀態欄。
BR-003　一案多個契約版本，僅一筆「目前版本」。
BR-004　改利率、天數、計息、違約金、沖帳覆寫＝新版本。舊列不得改那些欄。
D10　　　資金來源寫死 OWNER；V1 不得出現投資人資料表。
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import audit, compliance, dates
from .config import Settings, get_settings
from .enums import (
    AuditAction, CaseStatus, ContractSource, DayCountCalendar, FundingSource,
    InterestMethod, RateType, RateUnit,
)
from .errors import ErrorCode, SlosError
from .models import Case, ContractVersion, Customer
from .money import D, ZERO, money
from .rbac import Actor, require
from .receivable import terms_of
from .sentinels import MISSING, NOT_APPLICABLE, require_text_or_sentinel

#: 禁止在進件輸入出現的欄位（銀行授信用語、V1 禁止功能）
FORBIDDEN_INPUT_KEYS: frozenset[str] = frozenset({
    "approval_status", "approved", "credit_score", "investor_id", "funding_pool",
    "crowdfunding", "profit_share", "bureau_report", "appraisal_value",
})


@dataclass
class IntakeInput:
    """進件最少輸入（辰）。畫面欄位名為繁中，資料欄位名維持英文。"""

    customer_name: str                 # 借款人（請遮蔽顯示）
    principal: Decimal                 # 本金（契約面額）
    term_days: int                     # 借款天數
    rate_value: Decimal                # 利率值
    rate_unit: str                     # 利率單位：年／日／本期／固定金額
    interest_method: str               # 計息方法：期間定額／按日365
    disburse_date: dt.date             # 撥款日
    rate_type: str = RateType.CONTRACT.value
    period_flat_amount: Decimal | None = None
    sticky_interest: bool = False
    fee_amount: Decimal = ZERO         # 費用
    fee_rule: str = NOT_APPLICABLE
    penalty_rule: str = NOT_APPLICABLE  # 違約金規則：無／有
    penalty_amount: Decimal = ZERO
    late_interest_rule: str = NOT_APPLICABLE
    allocation_override: str = NOT_APPLICABLE
    contract_ref: str = MISSING        # 借據：有／MISSING
    cash_flow_method: str = MISSING    # 金流：銀行／現金／MISSING
    national_id: str = MISSING
    phone: str = MISSING
    address: str = MISSING
    bank_account: str = MISSING
    note: str = NOT_APPLICABLE


def _next_case_no(session: Session, day: dt.date) -> str:
    prefix = f"L{day:%Y%m%d}"
    used = session.scalar(
        select(func.count(Case.id)).where(Case.case_no.like(f"{prefix}%"))
    ) or 0
    return f"{prefix}-{used + 1:03d}"


def _next_customer_no(session: Session) -> str:
    used = session.scalar(select(func.count(Customer.id))) or 0
    return f"C{used + 1:06d}"


def reject_forbidden_input(payload: dict[str, object]) -> None:
    """本系統永不核貸，也不得偷渡投資人／募資欄位。"""
    hit = sorted(set(payload) & FORBIDDEN_INPUT_KEYS)
    if hit:
        code = (
            ErrorCode.E_NOT_AN_APPROVAL_SYSTEM
            if any(k.startswith("approv") or k == "credit_score" for k in hit)
            else ErrorCode.E_FORBIDDEN_FEATURE
        )
        raise SlosError(code, detail=f"不接受欄位 {hit}")


def get_or_create_customer(
    session: Session, actor: Actor, data: IntakeInput
) -> Customer:
    name = require_text_or_sentinel(data.customer_name, "借款人姓名")
    found = session.scalar(select(Customer).where(Customer.name == name))
    if found is not None:
        return found
    customer = Customer(
        customer_no=_next_customer_no(session),
        name=name,
        national_id=require_text_or_sentinel(data.national_id, "身分證字號"),
        phone=require_text_or_sentinel(data.phone, "電話"),
        address=require_text_or_sentinel(data.address, "地址"),
        bank_account=require_text_or_sentinel(data.bank_account, "帳號"),
        created_by=actor.name,
    )
    session.add(customer)
    session.flush()
    audit.record(session, actor, AuditAction.CREATE, "Customer", customer.customer_no)
    return customer


def _validate_terms(data: IntakeInput, cfg: Settings) -> None:
    dates.validate_term_days(data.term_days, cfg)
    if data.interest_method == InterestMethod.CUSTOM.value:
        raise SlosError(ErrorCode.E_CUSTOM_FORMULA_UNSUPPORTED)
    if data.rate_unit not in {u.value for u in RateUnit}:
        raise SlosError(ErrorCode.E_PENDING_DECISION, detail=f"利率單位 {data.rate_unit}")
    if data.interest_method not in {m.value for m in InterestMethod}:
        raise SlosError(ErrorCode.E_PENDING_DECISION, detail=f"計息方法 {data.interest_method}")
    if (
        data.rate_unit == RateUnit.FIXED_AMOUNT.value
        and data.period_flat_amount is None
    ):
        raise SlosError(ErrorCode.E_MISSING_VALUE, detail="固定金額利率需填期間固定利息")
    if D(data.principal) <= 0:
        raise SlosError(ErrorCode.E_NEGATIVE_AMOUNT, detail="本金必須大於零")


def intake(
    session: Session,
    actor: Actor,
    data: IntakeInput,
    *,
    settings: Settings | None = None,
) -> tuple[Case, ContractVersion, list[compliance.Flag]]:
    """進件：建立案件與第 1 版契約。建立案件 ≠ 核准貸款。"""
    require(actor, "INTAKE")
    cfg = settings or get_settings()
    _validate_terms(data, cfg)

    customer = get_or_create_customer(session, actor, data)
    maturity = dates.maturity_date(data.disburse_date, data.term_days, cfg)

    case = Case(
        case_no=_next_case_no(session, data.disburse_date),
        customer_id=customer.id,
        status=CaseStatus.DRAFT.value,
        funding_source=FundingSource.OWNER.value,
        opened_date=data.disburse_date,
        note=data.note,
        created_by=actor.name,
    )
    session.add(case)
    session.flush()

    contract = ContractVersion(
        case_id=case.id,
        version_no=1,
        is_current=True,
        face_amount=money(data.principal),
        term_days=data.term_days,
        rate_type=data.rate_type,
        rate_value=D(data.rate_value),
        rate_unit=data.rate_unit,
        interest_method=data.interest_method,
        day_count_calendar=DayCountCalendar.CALENDAR.value,
        period_flat_amount=(
            money(data.period_flat_amount) if data.period_flat_amount is not None else None
        ),
        sticky_interest=data.sticky_interest,
        fee_rule=data.fee_rule,
        penalty_rule=data.penalty_rule,
        late_interest_rule=data.late_interest_rule,
        allocation_override=data.allocation_override,
        fee_amount=money(data.fee_amount),
        penalty_amount=money(data.penalty_amount),
        source=ContractSource.INTAKE.value,
        effective_date=data.disburse_date,
        maturity_date=maturity,
        contract_ref=require_text_or_sentinel(data.contract_ref, "借據編號"),
        created_by=actor.name,
    )
    session.add(contract)
    session.flush()

    flags = compliance.evaluate(
        terms_of(contract),
        fee_amount=D(contract.fee_amount),
        has_penalty_rule=contract.penalty_rule not in {NOT_APPLICABLE, "無"},
        evidence_ref=data.cash_flow_method,
        settings=cfg,
    )
    compliance.persist(session, flags, case_id=case.id, contract_version_id=contract.id)

    audit.record(
        session, actor, AuditAction.CREATE, "Case", case.case_no,
        detail={
            "term_days": data.term_days,
            "maturity_date": str(maturity),
            "rate_unit": data.rate_unit,
            "interest_method": data.interest_method,
            "note": "建立案件不是核貸，本系統永不核貸。",
        },
    )
    return case, contract, flags


def new_version(
    session: Session,
    actor: Actor,
    case: Case,
    *,
    source: str,
    effective_date: dt.date,
    term_days: int,
    rate_value: Decimal | None = None,
    rate_unit: str | None = None,
    interest_method: str | None = None,
    period_flat_amount: Decimal | None = None,
    sticky_interest: bool | None = None,
    fee_amount: Decimal | None = None,
    fee_rule: str | None = None,
    penalty_rule: str | None = None,
    penalty_amount: Decimal | None = None,
    late_interest_rule: str | None = None,
    allocation_override: str | None = None,
    face_amount: Decimal | None = None,
    settings: Settings | None = None,
) -> ContractVersion:
    """建立新的契約版本。舊版本保留，不得就地改關鍵欄位（BR-004）。"""
    cfg = settings or get_settings()
    dates.validate_term_days(term_days, cfg)
    current = case.current_contract
    maturity = dates.maturity_date(effective_date, term_days, cfg)

    current.is_current = False
    session.flush()

    version = ContractVersion(
        case_id=case.id,
        version_no=current.version_no + 1,
        is_current=True,
        face_amount=money(face_amount if face_amount is not None else current.face_amount),
        term_days=term_days,
        rate_type=current.rate_type,
        rate_value=D(rate_value if rate_value is not None else current.rate_value),
        rate_unit=rate_unit or current.rate_unit,
        interest_method=interest_method or current.interest_method,
        day_count_calendar=current.day_count_calendar,
        period_flat_amount=(
            money(period_flat_amount) if period_flat_amount is not None
            else current.period_flat_amount
        ),
        sticky_interest=(
            current.sticky_interest if sticky_interest is None else sticky_interest
        ),
        fee_rule=fee_rule or current.fee_rule,
        penalty_rule=penalty_rule or current.penalty_rule,
        late_interest_rule=late_interest_rule or current.late_interest_rule,
        allocation_override=allocation_override or current.allocation_override,
        fee_amount=money(fee_amount if fee_amount is not None else current.fee_amount),
        penalty_amount=money(
            penalty_amount if penalty_amount is not None else current.penalty_amount
        ),
        source=source,
        effective_date=effective_date,
        maturity_date=maturity,
        contract_ref=current.contract_ref,
        created_by=actor.name,
    )
    session.add(version)
    session.flush()
    return version


def set_status(
    session: Session, actor: Actor, case: Case, status: CaseStatus, *, note: str = "N/A"
) -> Case:
    """案件狀態機（己）。已結清不得同時進行中。"""
    allowed: dict[str, set[str]] = {
        CaseStatus.DRAFT.value: {CaseStatus.DISBURSED.value, CaseStatus.CANCELLED.value},
        CaseStatus.DISBURSED.value: {CaseStatus.ACTIVE.value},
        CaseStatus.ACTIVE.value: {
            CaseStatus.PARTIALLY_REPAID.value, CaseStatus.OVERDUE.value,
            CaseStatus.EXTENDED.value, CaseStatus.SETTLED.value,
            CaseStatus.WRITTEN_OFF.value, CaseStatus.ACTIVE.value,
        },
        CaseStatus.PARTIALLY_REPAID.value: {
            CaseStatus.ACTIVE.value, CaseStatus.OVERDUE.value, CaseStatus.EXTENDED.value,
            CaseStatus.SETTLED.value, CaseStatus.WRITTEN_OFF.value,
            CaseStatus.PARTIALLY_REPAID.value,
        },
        CaseStatus.OVERDUE.value: {
            CaseStatus.PARTIALLY_REPAID.value, CaseStatus.EXTENDED.value,
            CaseStatus.SETTLED.value, CaseStatus.WRITTEN_OFF.value,
            CaseStatus.OVERDUE.value, CaseStatus.ACTIVE.value,
        },
        CaseStatus.EXTENDED.value: {
            CaseStatus.ACTIVE.value, CaseStatus.OVERDUE.value,
            CaseStatus.PARTIALLY_REPAID.value, CaseStatus.SETTLED.value,
            CaseStatus.WRITTEN_OFF.value,
        },
        CaseStatus.SETTLED.value: set(),
        CaseStatus.WRITTEN_OFF.value: {CaseStatus.SETTLED.value, CaseStatus.WRITTEN_OFF.value},
        CaseStatus.CANCELLED.value: set(),
    }
    target = status.value if hasattr(status, "value") else str(status)
    if target not in allowed.get(case.status, set()):
        raise SlosError(
            ErrorCode.E_STATE_TRANSITION,
            detail=f"{case.case_no}：{case.status} → {target}",
        )
    case.status = target
    session.flush()
    audit.record(
        session, actor, AuditAction.CREATE, "CaseStatus", case.case_no,
        detail={"status": target, "note": note},
    )
    return case
