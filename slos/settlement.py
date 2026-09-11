"""結清（丑／BR-028／己）。

結清試算 ≠ 已結清。試算與入帳分開。
案件要等入帳後尾差小於容差才變已結清。
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import audit, cases as case_service, collection, receivable
from .config import Settings, get_settings
from .enums import AuditAction, CaseStatus, PaymentMethod, SettlementQuoteStatus
from .errors import ErrorCode, SlosError
from .models import Case, Receipt, Settlement, SettlementQuote
from .money import money
from .rbac import Actor, require
from .receivable import ReceivableView
from .sentinels import MISSING


@dataclass
class QuoteResult:
    quote: SettlementQuote
    view: ReceivableView
    notes_zh: list[str]


def _next_quote_no(session: Session, day: dt.date) -> str:
    prefix = f"Q{day:%Y%m%d}"
    used = session.scalar(
        select(func.count(SettlementQuote.id)).where(SettlementQuote.quote_no.like(f"{prefix}%"))
    ) or 0
    return f"{prefix}-{used + 1:03d}"


def quote(
    session: Session,
    actor: Actor,
    case: Case,
    as_of: dt.date,
    *,
    settings: Settings | None = None,
) -> QuoteResult:
    """結清試算。只產報價，不動帳。"""
    require(actor, "SETTLE_QUOTE")
    cfg = settings or get_settings()
    view = receivable.compute(session, case, as_of, settings=cfg)
    record = SettlementQuote(
        case_id=case.id,
        quote_no=_next_quote_no(session, as_of),
        as_of_date=as_of,
        valid_until=as_of + dt.timedelta(days=cfg.settlement_quote_valid_days),
        principal=view.principal_outstanding,
        interest=view.interest_due,
        fee=view.fee_due,
        penalty=view.penalty_due,
        total=view.total_due,
        status=SettlementQuoteStatus.QUOTING.value,
        created_by=actor.name,
    )
    session.add(record)
    session.flush()
    receivable.snapshot(session, case, as_of, receivable.TRIGGER_SETTLE_QUOTE)
    audit.record(
        session, actor, AuditAction.SETTLE_QUOTE, "SettlementQuote", record.quote_no,
        detail={"case_no": case.case_no, "total": str(view.total_due)},
    )
    notes = [
        "結清試算不是已結清（BR-028）。報價有效期到期後必須重新試算。",
        f"報價基準日 {as_of}，有效至 {record.valid_until}。",
    ]
    notes.extend(view.warnings_zh)
    return QuoteResult(quote=record, view=view, notes_zh=notes)


def post(
    session: Session,
    actor: Actor,
    case: Case,
    quote_record: SettlementQuote,
    *,
    amount: Decimal,
    txn_date: dt.date,
    idempotency_key: str,
    method: str = PaymentMethod.BANK.value,
    evidence_ref: str = MISSING,
    settings: Settings | None = None,
) -> tuple[Settlement, Receipt]:
    """結清入帳。入帳後尾差小於容差才把案件轉已結清。"""
    require(actor, "COLLECT")
    cfg = settings or get_settings()
    if quote_record.status != SettlementQuoteStatus.QUOTING.value:
        raise SlosError(ErrorCode.E_SETTLEMENT_NOT_QUOTED, detail=quote_record.quote_no)
    if txn_date > quote_record.valid_until:
        quote_record.status = SettlementQuoteStatus.EXPIRED.value
        session.flush()
        raise SlosError(ErrorCode.E_QUOTE_EXPIRED, detail=quote_record.quote_no)

    receipt, _result, _plan = collection.post(
        session, actor, case,
        amount=amount, txn_date=txn_date, idempotency_key=idempotency_key,
        method=method, evidence_ref=evidence_ref, settings=cfg,
    )
    after = receivable.compute(session, case, txn_date, settings=cfg)
    residual = money(after.total_due)

    record = Settlement(
        case_id=case.id,
        quote_id=quote_record.id,
        receipt_id=receipt.id,
        residual=residual,
        created_by=actor.name,
    )
    session.add(record)
    quote_record.status = SettlementQuoteStatus.POSTED.value
    session.flush()

    if residual <= cfg.amount_tolerance:
        case_service.set_status(session, actor, case, CaseStatus.SETTLED, note="結清入帳")
        case.closed_date = txn_date
        session.flush()
    audit.record(
        session, actor, AuditAction.SETTLE_POST, "Settlement", record.id,
        detail={
            "case_no": case.case_no, "quote_no": quote_record.quote_no,
            "residual": str(residual), "status": case.status,
        },
        warning="尾差大於容差，案件尚未結清。" if residual > cfg.amount_tolerance else "N/A",
    )
    return record, receipt
