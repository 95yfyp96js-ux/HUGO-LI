"""調整、沖正、核銷、收回（寅）。

沖正產生反向分錄，原列標已沖正（本系統以是否存在沖正傳票衍生，不就地覆寫）。
調整永遠新增。利息轉本金預設拒絕。
核銷不刪案。之後收款走收回。
核銷、重開帳期、利息轉本金、超過單筆調整上限：要管理員。單人模式寫警告。
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

from sqlalchemy.orm import Session

from . import accounts, audit, cases as case_service, ledger, positions
from .config import Settings, get_settings
from .enums import (
    AllocationBucket, AuditAction, CaseStatus, ComplianceFlag, PaymentMethod, Role, TxnType,
)
from .errors import ErrorCode, SlosError
from .models import Adjustment, Case, ComplianceFlagRecord, JournalEntry, Receipt, WriteOff
from .money import money
from .rbac import Actor, require
from .sentinels import MISSING

ADJUST_GENERIC = "GENERIC"
ADJUST_INTEREST_TO_PRINCIPAL = "INTEREST_TO_PRINCIPAL"

ADJUST_TYPE_ZH: dict[str, str] = {
    ADJUST_GENERIC: "一般調整",
    ADJUST_INTEREST_TO_PRINCIPAL: "利息轉本金",
}


def _require_admin(actor: Actor, what: str) -> None:
    if actor.role != Role.ADMIN.value:
        raise SlosError(ErrorCode.E_PERMISSION_DENIED, detail=f"{what} 須系統管理員")


def adjust(
    session: Session,
    actor: Actor,
    case: Case | None,
    *,
    target_account: str,
    increase: bool,
    amount: Decimal,
    reason: str,
    txn_date: dt.date,
    idempotency_key: str,
    approved_by: str = "N/A",
    settings: Settings | None = None,
) -> Adjustment:
    """一般調整。對方科目固定為 9990 調整，永遠新增，不改舊列。"""
    require(actor, "ADJUST")
    cfg = settings or get_settings()
    booked = money(amount)
    if booked <= 0:
        raise SlosError(ErrorCode.E_NEGATIVE_AMOUNT, detail="調整金額必須大於零")
    if not reason or not reason.strip():
        raise SlosError(ErrorCode.E_MISSING_VALUE, detail="調整原因")
    if booked > cfg.adjustment_single_limit and actor.role != Role.ADMIN.value:
        raise SlosError(
            ErrorCode.E_ADJUSTMENT_LIMIT,
            detail=f"單筆上限 {cfg.adjustment_single_limit}",
        )
    accounts.get(target_account)

    lines = (
        [
            ledger.Line(target_account, debit=booked,
                        case_id=case.id if case else None, memo=reason),
            ledger.Line(accounts.ADJUSTMENT, credit=booked,
                        case_id=case.id if case else None, memo=reason),
        ]
        if increase
        else [
            ledger.Line(accounts.ADJUSTMENT, debit=booked,
                        case_id=case.id if case else None, memo=reason),
            ledger.Line(target_account, credit=booked,
                        case_id=case.id if case else None, memo=reason),
        ]
    )
    result = ledger.post(
        session, actor,
        txn_type=TxnType.ADJUSTMENT,
        txn_date=txn_date,
        value_date=txn_date,
        case_id=case.id if case else None,
        idempotency_key=idempotency_key,
        memo=f"調整：{reason}",
        lines=lines,
    )
    record = Adjustment(
        case_id=case.id if case else None,
        adjust_type=ADJUST_GENERIC,
        amount=booked,
        reason=reason.strip(),
        approved_by=approved_by,
        legal_review_required=False,
        journal_entry_id=result.entry.id,
        created_by=actor.name,
    )
    session.add(record)
    session.flush()
    audit.record(
        session, actor, AuditAction.ADJUST, "Adjustment", record.id,
        detail={"account": target_account, "increase": increase, "amount": str(booked),
                "reason": reason},
    )
    audit.record_segregation_warning(
        session, actor, "Adjustment", record.id, "同一人提出並核准調整（V1 單人模式）。"
    )
    return record


def capitalize_interest(
    session: Session,
    actor: Actor,
    case: Case,
    *,
    amount: Decimal,
    reason: str,
    txn_date: dt.date,
    idempotency_key: str,
    legal_review_acknowledged: bool = False,
    settings: Settings | None = None,
) -> Adjustment:
    """利息轉本金。BR-011：預設拒絕，必須管理員＋法律審查標記才走調整指令。"""
    if not legal_review_acknowledged:
        raise SlosError(
            ErrorCode.E_CAPITALIZATION_FORBIDDEN,
            detail="未勾選法律審查確認；民法第 207 條利息不得滾入原本，例外極窄。",
        )
    _require_admin(actor, "利息轉本金")
    require(actor, "ADJUST")
    booked = money(amount)
    if booked <= 0:
        raise SlosError(ErrorCode.E_NEGATIVE_AMOUNT, detail="金額必須大於零")

    result = ledger.post(
        session, actor,
        txn_type=TxnType.ADJUSTMENT,
        txn_date=txn_date,
        value_date=txn_date,
        case_id=case.id,
        idempotency_key=idempotency_key,
        memo=f"利息轉本金（需法律審查）：{reason}",
        lines=[
            ledger.Line(accounts.AR_PRINCIPAL, debit=booked,
                        bucket=AllocationBucket.PRINCIPAL.value, case_id=case.id,
                        memo="利息轉本金"),
            ledger.Line(accounts.ADJUSTMENT, credit=booked, case_id=case.id,
                        memo="利息轉本金對方科目"),
        ],
    )
    record = Adjustment(
        case_id=case.id,
        adjust_type=ADJUST_INTEREST_TO_PRINCIPAL,
        amount=booked,
        reason=reason.strip(),
        approved_by=actor.name,
        legal_review_required=True,
        journal_entry_id=result.entry.id,
        created_by=actor.name,
    )
    session.add(record)
    session.flush()
    for flag in (ComplianceFlag.POSSIBLE_COMPOUNDING, ComplianceFlag.NEEDS_LEGAL_REVIEW):
        session.add(ComplianceFlagRecord(
            case_id=case.id,
            contract_version_id=case.current_contract.id,
            flag=flag.value,
            detail="人工核准把利息轉入本金。民法第 207 條例外極窄，須律師確認。",
        ))
    session.flush()
    audit.record(
        session, actor, AuditAction.ADJUST, "Adjustment", record.id,
        detail={"type": ADJUST_INTEREST_TO_PRINCIPAL, "amount": str(booked), "reason": reason},
        warning="可能複利／需法律審查。系統不提供法律意見。",
    )
    return record


def reverse_entry(
    session: Session, actor: Actor, entry: JournalEntry, *, reason: str, idempotency_key: str
) -> ledger.PostResult:
    require(actor, "ADJUST")
    if not reason or not reason.strip():
        raise SlosError(ErrorCode.E_MISSING_VALUE, detail="沖正原因")
    return ledger.reverse(
        session, actor, entry, idempotency_key=idempotency_key, reason=reason.strip()
    )


def write_off(
    session: Session,
    actor: Actor,
    case: Case,
    *,
    reason: str,
    txn_date: dt.date,
    idempotency_key: str,
    amount: Decimal | None = None,
) -> WriteOff:
    """核銷不刪案件（BR-024）。需管理員核准（BR-029）。"""
    require(actor, "WRITEOFF_APPROVE")
    _require_admin(actor, "核銷")
    if not reason or not reason.strip():
        raise SlosError(ErrorCode.E_MISSING_VALUE, detail="核銷原因")
    outstanding = positions.principal_outstanding(session, case.id)
    booked = money(amount if amount is not None else outstanding)
    if booked <= 0:
        raise SlosError(ErrorCode.E_NEGATIVE_AMOUNT, detail="核銷金額必須大於零")
    if booked > outstanding:
        raise SlosError(ErrorCode.E_PRINCIPAL_NEGATIVE, detail="核銷金額大於未償本金")

    result = ledger.post(
        session, actor,
        txn_type=TxnType.WRITEOFF,
        txn_date=txn_date,
        value_date=txn_date,
        case_id=case.id,
        idempotency_key=idempotency_key,
        memo=f"核銷：{reason}",
        lines=[
            ledger.Line(accounts.ADJUSTMENT, debit=booked, case_id=case.id, memo="核銷"),
            ledger.Line(accounts.AR_PRINCIPAL, credit=booked,
                        bucket=AllocationBucket.PRINCIPAL.value, case_id=case.id,
                        memo="沖銷應收本金"),
        ],
    )
    record = WriteOff(
        case_id=case.id, amount=booked, reason=reason.strip(),
        approved_by=actor.name, journal_entry_id=result.entry.id, created_by=actor.name,
    )
    session.add(record)
    session.flush()
    case_service.set_status(session, actor, case, CaseStatus.WRITTEN_OFF, note="核銷")
    audit.record(
        session, actor, AuditAction.WRITEOFF, "WriteOff", record.id,
        detail={"case_no": case.case_no, "amount": str(booked), "reason": reason},
        warning="核銷不刪案件；日後收款走收回。",
    )
    return record


def recovery(
    session: Session,
    actor: Actor,
    case: Case,
    *,
    amount: Decimal,
    txn_date: dt.date,
    idempotency_key: str,
    method: str = PaymentMethod.BANK.value,
    evidence_ref: str = MISSING,
) -> Receipt:
    """核銷後收款＝收回（BR-024）。不還原原本的應收，走調整科目。"""
    require(actor, "COLLECT")
    if case.status != CaseStatus.WRITTEN_OFF.value:
        raise SlosError(
            ErrorCode.E_STATE_TRANSITION, detail="只有已核銷案件才能走收回，請改用 /collect"
        )
    booked = money(amount)
    cash_account = accounts.cash_account_for(method)
    from .enums import ReconStatus, TxnStatus
    from .sentinels import require_evidence_ref

    ref = require_evidence_ref(evidence_ref, "收回流水")
    receipt = Receipt(
        case_id=case.id, txn_date=txn_date, value_date=txn_date, amount=booked,
        method=method, evidence_ref=ref, idempotency_key=idempotency_key,
        status=TxnStatus.DRAFT.value, recon_status=ReconStatus.PENDING.value,
        is_recovery=True, created_by=actor.name,
    )
    session.add(receipt)
    session.flush()

    result = ledger.post(
        session, actor,
        txn_type=TxnType.RECOVERY,
        txn_date=txn_date,
        value_date=txn_date,
        case_id=case.id,
        idempotency_key=idempotency_key,
        memo=f"收回 {case.case_no}",
        lines=[
            ledger.Line(cash_account, debit=booked, case_id=case.id, memo="收回資金"),
            ledger.Line(accounts.ADJUSTMENT, credit=booked, case_id=case.id, memo="核銷後收回"),
        ],
    )
    receipt.status = TxnStatus.POSTED.value
    receipt.journal_entry_id = result.entry.id
    receipt.posted_at = result.entry.posted_at
    session.flush()
    audit.record(
        session, actor, AuditAction.RECOVERY, "Receipt", receipt.id,
        detail={"case_no": case.case_no, "amount": str(booked)},
    )
    return receipt
