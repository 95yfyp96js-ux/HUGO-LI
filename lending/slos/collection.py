"""收款引擎（壬）與沖帳入帳。

先建實收，再預覽沖帳，確認後才入帳。實收 ≠ 沖帳。
無案件編號 → 暫收「無法認列」＋現金增加＋貸暫收（BR-014）。
禁止只靠金額自動配案。
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy.orm import Session

from . import accounts, allocation, audit, ledger, periods, receivable
from .config import Settings, get_settings
from .enums import (
    AllocationBucket, AuditAction, CaseStatus, PaymentMethod, ReconStatus, SuspenseReason,
    TxnStatus, TxnType,
)
from .errors import ErrorCode, SlosError
from .models import Allocation, Case, Receipt, SuspenseEntry
from .money import money
from .rbac import Actor, require
from .receivable import ReceivableView
from .sentinels import MISSING, is_sentinel, require_evidence_ref
from . import cases as case_service


@dataclass
class CollectPreview:
    case_no: str
    amount: Decimal
    as_of: dt.date
    view: ReceivableView | None
    plan: allocation.AllocationPlan | None
    entries_zh: list[str]
    warnings_zh: list[str] = field(default_factory=list)
    unidentified: bool = False


def preview(
    session: Session,
    case: Case | None,
    amount: Decimal,
    as_of: dt.date,
    *,
    method: str = PaymentMethod.BANK.value,
    payer_designation: str | None = None,
    evidence_ref: str = MISSING,
    settings: Settings | None = None,
) -> CollectPreview:
    cfg = settings or get_settings()
    booked = money(amount)
    cash_account = accounts.cash_account_for(method)
    warnings: list[str] = []
    if is_sentinel(evidence_ref):
        warnings.append("缺銀行流水，入帳後對帳狀態為「待對」（D06）。")

    if case is None:
        warnings.append(
            "沒有案件編號，只能掛暫收「無法認列」。禁止只靠金額自動猜案件（BR-014）。"
        )
        return CollectPreview(
            case_no="MISSING",
            amount=booked,
            as_of=as_of,
            view=None,
            plan=None,
            entries_zh=[
                f"借　{cash_account} {accounts.name_zh(cash_account)}　{booked}",
                f"貸　{accounts.SUSPENSE} {accounts.name_zh(accounts.SUSPENSE)}　{booked}",
            ],
            warnings_zh=warnings,
            unidentified=True,
        )

    view = receivable.compute(session, case, as_of, settings=cfg)
    contract = case.current_contract
    plan = allocation.plan(
        view, booked,
        allocation_override=contract.allocation_override,
        payer_designation=payer_designation,
        settings=cfg,
    )
    entries = [f"借　{cash_account} {accounts.name_zh(cash_account)}　{booked}"]
    for line in plan.lines:
        credit_account = accounts.BUCKET_CREDIT_ACCOUNT[line.bucket]
        entries.append(
            f"貸　{credit_account} {accounts.name_zh(credit_account)}　{line.amount}"
            f"（{line.bucket_zh}／{line.source_zh}）"
        )
    warnings.extend(view.warnings_zh)
    return CollectPreview(
        case_no=case.case_no, amount=booked, as_of=as_of, view=view, plan=plan,
        entries_zh=entries, warnings_zh=warnings,
    )


def post(
    session: Session,
    actor: Actor,
    case: Case | None,
    *,
    amount: Decimal,
    txn_date: dt.date,
    idempotency_key: str,
    method: str = PaymentMethod.BANK.value,
    value_date: dt.date | None = None,
    evidence_ref: str = MISSING,
    payer_designation: str | None = None,
    is_recovery: bool = False,
    settings: Settings | None = None,
) -> tuple[Receipt, ledger.PostResult, allocation.AllocationPlan | None]:
    require(actor, "COLLECT")
    cfg = settings or get_settings()
    booked = money(amount)
    if booked <= 0:
        raise SlosError(ErrorCode.E_NEGATIVE_AMOUNT, detail="收款金額必須大於零")
    ref = require_evidence_ref(evidence_ref, "收款流水")
    settle_date = value_date or txn_date
    periods.assert_open(session, txn_date, actor)

    existing_entry = ledger.find_by_idempotency(session, idempotency_key)
    if existing_entry is not None:
        found = session.query(Receipt).filter(
            Receipt.idempotency_key == idempotency_key
        ).one()
        return found, ledger.PostResult(
            entry=existing_entry, duplicate=True,
            message_zh="相同冪等鍵已入帳，本次不重複記帳。",
        ), None

    receipt = Receipt(
        case_id=case.id if case is not None else None,
        txn_date=txn_date,
        value_date=settle_date,
        amount=booked,
        method=method,
        evidence_ref=ref,
        idempotency_key=idempotency_key,
        status=TxnStatus.DRAFT.value,
        recon_status=ReconStatus.PENDING.value,
        payer_designation=payer_designation or "N/A",
        is_recovery=is_recovery,
        created_by=actor.name,
    )
    session.add(receipt)
    session.flush()

    cash_account = accounts.cash_account_for(method)
    lines = [ledger.Line(cash_account, debit=booked,
                         case_id=case.id if case else None, memo="收到資金")]
    plan: allocation.AllocationPlan | None = None

    if case is None:
        lines.append(ledger.Line(
            accounts.SUSPENSE, credit=booked, bucket=AllocationBucket.SUSPENSE.value,
            memo="暫收：無法認列",
        ))
    else:
        view = receivable.compute(session, case, txn_date, settings=cfg)
        contract = case.current_contract
        plan = allocation.plan(
            view, booked,
            allocation_override=contract.allocation_override,
            payer_designation=payer_designation,
            settings=cfg,
        )
        for line in plan.lines:
            lines.append(ledger.Line(
                accounts.BUCKET_CREDIT_ACCOUNT[line.bucket],
                credit=line.amount,
                bucket=line.bucket,
                case_id=case.id,
                memo=f"{line.bucket_zh}（{line.source_zh}）",
            ))

    result = ledger.post(
        session, actor,
        txn_type=TxnType.RECOVERY if is_recovery else TxnType.RECEIPT,
        txn_date=txn_date,
        value_date=settle_date,
        case_id=case.id if case else None,
        idempotency_key=idempotency_key,
        memo=f"收款 {case.case_no if case else '無法認列'}",
        lines=lines,
    )
    receipt.status = TxnStatus.POSTED.value
    receipt.journal_entry_id = result.entry.id
    receipt.posted_at = result.entry.posted_at
    session.flush()

    if case is None:
        session.add(SuspenseEntry(
            receipt_id=receipt.id, case_id=None, amount=booked,
            reason=SuspenseReason.UNIDENTIFIED.value, opened_date=txn_date,
            note="沒有案件編號。禁止只靠金額自動猜案件（BR-014）。",
        ))
        session.flush()
    else:
        for index, line in enumerate(plan.lines, start=1):
            session.add(Allocation(
                receipt_id=receipt.id, case_id=case.id, sequence=index,
                bucket=line.bucket, amount=line.amount, rule_code=line.rule_code,
            ))
            if line.bucket == AllocationBucket.SUSPENSE.value:
                session.add(SuspenseEntry(
                    receipt_id=receipt.id, case_id=case.id, amount=line.amount,
                    reason=SuspenseReason.OVERPAYMENT.value, opened_date=txn_date,
                    note="溢繳進暫收，不是收入，也不是負本金（BR-013）。",
                ))
        session.flush()
        _advance_case_status(session, actor, case, txn_date, plan, cfg)
        receivable.snapshot(session, case, txn_date, receivable.TRIGGER_PARTIAL_REPAY)

    audit.record(
        session, actor, AuditAction.POST, "Receipt", receipt.id,
        detail={
            "case_no": case.case_no if case else "MISSING",
            "amount": str(booked),
            "evidence_ref": ref,
            "allocation": [
                {"bucket": l.bucket, "amount": str(l.amount)} for l in (plan.lines if plan else [])
            ],
        },
        warning="缺銀行流水，對帳狀態待對。" if is_sentinel(ref) else "N/A",
    )
    return receipt, result, plan


def _advance_case_status(
    session: Session, actor: Actor, case: Case, as_of: dt.date,
    plan: allocation.AllocationPlan, cfg: Settings,
) -> None:
    principal_paid = any(
        line.bucket == AllocationBucket.PRINCIPAL.value and line.amount > 0
        for line in plan.lines
    )
    after = receivable.compute(session, case, as_of, settings=cfg)
    if after.total_due <= cfg.amount_tolerance:
        # BR-028：結清試算 ≠ 已結清。收款把應收沖到零不自動結案，需執行結清指令。
        audit.record(
            session, actor, AuditAction.POST, "Case", case.case_no,
            detail={"note": "應收已為零，請執行結清指令完成結案。"},
            warning="應收為零但尚未結清。",
        )
        return
    if after.is_overdue and case.status != CaseStatus.OVERDUE.value:
        case_service.set_status(session, actor, case, CaseStatus.OVERDUE, note="收款後仍逾期")
    elif principal_paid and case.status in {
        CaseStatus.ACTIVE.value, CaseStatus.PARTIALLY_REPAID.value, CaseStatus.OVERDUE.value,
    }:
        case_service.set_status(
            session, actor, case, CaseStatus.PARTIALLY_REPAID, note="部分還款"
        )


def reverse_receipt(
    session: Session, actor: Actor, receipt: Receipt, *, reason: str, idempotency_key: str
) -> ledger.PostResult:
    """沖正：產生反向分錄，原列不就地覆寫（寅）。"""
    from .models import JournalEntry

    if receipt.status != TxnStatus.POSTED.value or receipt.journal_entry_id is None:
        raise SlosError(ErrorCode.E_NOT_POSTED, detail=str(receipt.id))
    original = session.get(JournalEntry, receipt.journal_entry_id)
    return ledger.reverse(
        session, actor, original, idempotency_key=idempotency_key, reason=reason
    )
