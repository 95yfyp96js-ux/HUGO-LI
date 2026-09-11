"""撥款（階段 5）。帳上本金以實撥為準（BR-005）。

D06　沒有銀行流水也可入帳，對帳狀態＝待對。缺流水不等於事件不存在（BR-018）。
己　　已撥款必須有已入帳撥款。
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy.orm import Session

from . import accounts, audit, ledger, periods, receivable
from .enums import (
    AllocationBucket, AuditAction, CaseStatus, PaymentMethod, ReconStatus, TxnStatus, TxnType,
)
from .errors import ErrorCode, SlosError
from .models import Case, ContractVersion, Disbursement, ExternalEvidence
from .money import D, money
from .rbac import Actor, require
from .sentinels import MISSING, is_sentinel, require_evidence_ref
from . import cases as case_service


@dataclass
class DisbursePreview:
    case_no: str
    amount: Decimal
    method_zh: str
    txn_date: dt.date
    value_date: dt.date
    maturity_date: dt.date
    evidence_ref: str
    recon_status_zh: str
    entries_zh: list[str]
    warnings_zh: list[str]


def preview(
    session: Session, case: Case, amount: Decimal, method: str, txn_date: dt.date,
    value_date: dt.date | None = None, evidence_ref: str = MISSING,
) -> DisbursePreview:
    contract = case.current_contract
    cash_account = accounts.cash_account_for(method)
    booked = money(amount)
    warnings: list[str] = []
    if is_sentinel(evidence_ref):
        warnings.append(
            "沒有銀行流水仍可入帳，對帳狀態為「待對」；儀表板會列入未對帳（D06）。"
        )
    if booked != D(contract.face_amount):
        warnings.append(
            f"實撥 {booked} 與契約面額 {D(contract.face_amount)} 不同；帳上本金以實撥為準（BR-005）。"
        )
    from .labels import PAYMENT_METHOD, RECON_STATUS

    return DisbursePreview(
        case_no=case.case_no,
        amount=booked,
        method_zh=PAYMENT_METHOD.get(method, method),
        txn_date=txn_date,
        value_date=value_date or txn_date,
        maturity_date=contract.maturity_date,
        evidence_ref=evidence_ref,
        recon_status_zh=RECON_STATUS[ReconStatus.PENDING],
        entries_zh=[
            f"借　{accounts.AR_PRINCIPAL} {accounts.name_zh(accounts.AR_PRINCIPAL)}　{booked}",
            f"貸　{cash_account} {accounts.name_zh(cash_account)}　{booked}",
        ],
        warnings_zh=warnings,
    )


def post(
    session: Session,
    actor: Actor,
    case: Case,
    *,
    amount: Decimal,
    txn_date: dt.date,
    idempotency_key: str,
    method: str = PaymentMethod.BANK.value,
    value_date: dt.date | None = None,
    evidence_ref: str = MISSING,
) -> tuple[Disbursement, ledger.PostResult]:
    require(actor, "DISBURSE")
    contract: ContractVersion = case.current_contract
    booked = money(amount)
    if booked <= 0:
        raise SlosError(ErrorCode.E_NEGATIVE_AMOUNT, detail="撥款金額必須大於零")
    ref = require_evidence_ref(evidence_ref, "撥款流水")
    settle_date = value_date or txn_date
    periods.assert_open(session, txn_date, actor)

    existing = ledger.find_by_idempotency(session, idempotency_key)
    if existing is not None:
        found = session.query(Disbursement).filter(
            Disbursement.idempotency_key == idempotency_key
        ).one()
        return found, ledger.PostResult(
            entry=existing, duplicate=True, message_zh="相同冪等鍵已入帳，本次不重複記帳。"
        )

    record = Disbursement(
        case_id=case.id,
        contract_version_id=contract.id,
        txn_date=txn_date,
        value_date=settle_date,
        amount=booked,
        method=method,
        evidence_ref=ref,
        idempotency_key=idempotency_key,
        status=TxnStatus.DRAFT.value,
        recon_status=ReconStatus.PENDING.value,
        created_by=actor.name,
    )
    session.add(record)
    session.flush()

    cash_account = accounts.cash_account_for(method)
    result = ledger.post(
        session, actor,
        txn_type=TxnType.DISBURSEMENT,
        txn_date=txn_date,
        value_date=settle_date,
        case_id=case.id,
        idempotency_key=idempotency_key,
        memo=f"撥款 {case.case_no}",
        lines=[
            ledger.Line(accounts.AR_PRINCIPAL, debit=booked,
                        bucket=AllocationBucket.PRINCIPAL.value, case_id=case.id,
                        memo="應收本金"),
            ledger.Line(cash_account, credit=booked, case_id=case.id, memo="撥出資金"),
        ],
    )

    record.status = TxnStatus.POSTED.value
    record.journal_entry_id = result.entry.id
    record.posted_at = result.entry.posted_at
    session.flush()

    session.add(ExternalEvidence(
        case_id=case.id, ref_type="DISBURSEMENT", ref_id=record.id,
        evidence_type="BANK_STATEMENT" if method == PaymentMethod.BANK.value else "OTHER",
        evidence_ref=ref, amount=booked, value_date=settle_date,
        verified="NOT_VERIFIED" if is_sentinel(ref) else "PENDING",
        note="缺流水不等於事件不存在（BR-018）。" if is_sentinel(ref) else "N/A",
    ))

    if case.status == CaseStatus.DRAFT.value:
        case_service.set_status(session, actor, case, CaseStatus.DISBURSED, note="撥款入帳")
        case_service.set_status(session, actor, case, CaseStatus.ACTIVE, note="撥款後轉進行中")
    receivable.snapshot(session, case, txn_date, receivable.TRIGGER_DISBURSE)

    audit.record(
        session, actor, AuditAction.POST, "Disbursement", record.id,
        detail={"case_no": case.case_no, "amount": str(booked), "evidence_ref": ref},
        warning="缺銀行流水，對帳狀態待對。" if is_sentinel(ref) else "N/A",
    )
    audit.record_segregation_warning(
        session, actor, "Disbursement", record.id, "同一人進件並撥款（V1 單人模式）。"
    )
    return record, result
