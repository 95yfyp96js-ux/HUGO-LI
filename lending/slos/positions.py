"""分戶部位。所有餘額由已入帳交易推導，案件表不存可手改的餘額欄（戊）。"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import accounts, ledger
from .enums import AllocationBucket, TxnStatus
from .interest import Segment
from .models import (
    Allocation, Case, ContractVersion, Disbursement, JournalEntry, Receipt, SuspenseEntry,
)
from .money import D, ZERO, money


@dataclass
class Position:
    """案件分戶分量：本金、利息、費用、違約金、暫收貸方。"""

    principal_outstanding: Decimal
    principal_disbursed: Decimal
    interest_received: Decimal
    fee_received: Decimal
    penalty_received: Decimal
    suspense_credit: Decimal


def reversed_entry_ids(session: Session, entry_cutoff_id: int | None = None) -> set[int]:
    """已被沖正的傳票編號。沖正不就地覆寫原列，效果一律由此推導。"""
    query = select(JournalEntry.reverses_entry_id).where(
        JournalEntry.reverses_entry_id.is_not(None)
    )
    if entry_cutoff_id is not None:
        query = query.where(JournalEntry.id <= entry_cutoff_id)
    rows = session.execute(query).scalars().all()
    return {int(value) for value in rows}


def _not_reversed(session: Session, column, entry_cutoff_id: int | None = None):
    ids = reversed_entry_ids(session, entry_cutoff_id)
    if not ids:
        return column.is_not(None) | column.is_(None)
    return column.not_in(ids) | column.is_(None)


def disbursed_total(
    session: Session, case_id: int, *, as_of: dt.date | None = None,
    entry_cutoff_id: int | None = None,
) -> Decimal:
    query = select(Disbursement.amount).where(
        Disbursement.case_id == case_id,
        Disbursement.status == TxnStatus.POSTED.value,
        _not_reversed(session, Disbursement.journal_entry_id, entry_cutoff_id),
    )
    if as_of is not None:
        query = query.where(Disbursement.txn_date <= as_of)
    if entry_cutoff_id is not None:
        query = query.where(Disbursement.journal_entry_id <= entry_cutoff_id)
    rows = session.execute(query).scalars().all()
    return money(sum((D(a) for a in rows), ZERO))


def allocated_total(
    session: Session, case_id: int, bucket: AllocationBucket, *,
    as_of: dt.date | None = None, entry_cutoff_id: int | None = None,
) -> Decimal:
    query = (
        select(Allocation.amount)
        .join(Receipt, Receipt.id == Allocation.receipt_id)
        .where(
            Allocation.case_id == case_id,
            Allocation.bucket == bucket.value,
            Receipt.status == TxnStatus.POSTED.value,
            _not_reversed(session, Receipt.journal_entry_id, entry_cutoff_id),
        )
    )
    if as_of is not None:
        query = query.where(Receipt.txn_date <= as_of)
    if entry_cutoff_id is not None:
        query = query.where(Receipt.journal_entry_id <= entry_cutoff_id)
    rows = session.execute(query).scalars().all()
    return money(sum((D(a) for a in rows), ZERO))


def principal_outstanding(
    session: Session, case_id: int, *, as_of: dt.date | None = None,
    entry_cutoff_id: int | None = None,
) -> Decimal:
    """未償本金＝科目 1100 應收本金的案件別餘額。給基準日即可重放歷史（辛）。"""
    return ledger.account_balance(
        session, accounts.AR_PRINCIPAL, case_id=case_id, as_of=as_of,
        entry_cutoff_id=entry_cutoff_id,
    )


def suspense_credit(
    session: Session, case_id: int | None, *, as_of: dt.date | None = None,
    entry_cutoff_id: int | None = None,
) -> Decimal:
    return ledger.account_balance(
        session, accounts.SUSPENSE, case_id=case_id, as_of=as_of,
        entry_cutoff_id=entry_cutoff_id,
    )


def position(session: Session, case_id: int, *, as_of: dt.date | None = None) -> Position:
    return Position(
        principal_outstanding=principal_outstanding(session, case_id, as_of=as_of),
        principal_disbursed=disbursed_total(session, case_id, as_of=as_of),
        interest_received=allocated_total(
            session, case_id, AllocationBucket.INTEREST, as_of=as_of),
        fee_received=allocated_total(session, case_id, AllocationBucket.FEE, as_of=as_of),
        penalty_received=allocated_total(
            session, case_id, AllocationBucket.PENALTY, as_of=as_of),
        suspense_credit=suspense_credit(session, case_id, as_of=as_of),
    )


def principal_segments(
    session: Session,
    case: Case,
    contract: ContractVersion,
    as_of: dt.date,
    entry_cutoff_id: int | None = None,
) -> list[Segment]:
    """把本金變動事件切成區段，供計息引擎逐段累計（D04：部分還後依剩餘本金重算）。"""
    start = contract.effective_date
    end = min(as_of, contract.maturity_date)
    if end <= start:
        return []

    events: list[tuple[dt.date, Decimal]] = []
    rows = session.execute(
        select(Receipt.value_date, Allocation.amount)
        .join(Allocation, Allocation.receipt_id == Receipt.id)
        .where(
            Allocation.case_id == case.id,
            Allocation.bucket == AllocationBucket.PRINCIPAL.value,
            Receipt.status == TxnStatus.POSTED.value,
            _not_reversed(session, Receipt.journal_entry_id, entry_cutoff_id),
            (
                Receipt.journal_entry_id <= entry_cutoff_id
                if entry_cutoff_id is not None
                else Receipt.id.is_not(None)
            ),
        )
    ).all()
    for value_date, amount in rows:
        if start < value_date < end:
            events.append((value_date, D(amount)))
    events.sort(key=lambda item: item[0])

    principal = disbursed_total(session, case.id, as_of=as_of, entry_cutoff_id=entry_cutoff_id)
    # 區段起算本金＝實撥總額，逐次扣掉已沖本金
    segments: list[Segment] = []
    cursor = start
    for event_date, amount in events:
        if event_date > cursor:
            segments.append(Segment(start=cursor, end=event_date, principal=money(principal)))
            cursor = event_date
        principal = money(principal - amount)
    if cursor < end:
        segments.append(Segment(start=cursor, end=end, principal=money(principal)))
    return [seg for seg in segments if seg.days > 0]


def open_suspense(session: Session, case_id: int | None = None) -> list[SuspenseEntry]:
    query = select(SuspenseEntry).where(SuspenseEntry.cleared_date.is_(None))
    if case_id is not None:
        query = query.where(SuspenseEntry.case_id == case_id)
    return list(session.scalars(query).all())
