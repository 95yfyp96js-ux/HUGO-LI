"""對帳（丑）。

比對順序：流水＋金額＋方向＋日期正負兩天。
禁止只靠金額自動標「已配」。
缺銀行流水 ≠ 事件不存在（BR-018）；未對帳必須出現在儀表板（D06）。
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit
from .config import Settings, get_settings
from .enums import AuditAction, ReconStatus, TxnStatus
from .errors import ErrorCode, SlosError
from .models import Disbursement, Receipt, ReconciliationItem
from .money import D, money
from .rbac import Actor, require
from .sentinels import MISSING, is_sentinel

DIRECTION_IN = "IN"
DIRECTION_OUT = "OUT"


@dataclass
class StatementRow:
    """銀行流水匯入列。"""

    statement_ref: str
    amount: Decimal
    value_date: dt.date
    direction: str
    note: str = "N/A"


@dataclass
class ReconResult:
    matched: int
    duplicates: int
    unmatched: int
    no_evidence: int
    notes_zh: list[str]


def _candidates(session: Session) -> list[tuple[str, int, str, Decimal, dt.date, str]]:
    rows: list[tuple[str, int, str, Decimal, dt.date, str]] = []
    for record in session.scalars(
        select(Disbursement).where(Disbursement.status == TxnStatus.POSTED.value)
    ).all():
        rows.append(("DISBURSEMENT", record.id, record.evidence_ref, D(record.amount),
                     record.value_date, DIRECTION_OUT))
    for record in session.scalars(
        select(Receipt).where(Receipt.status == TxnStatus.POSTED.value)
    ).all():
        rows.append(("RECEIPT", record.id, record.evidence_ref, D(record.amount),
                     record.value_date, DIRECTION_IN))
    return rows


def _set_txn_recon_status(session: Session, ref_type: str, ref_id: int, status: str) -> None:
    model = Disbursement if ref_type == "DISBURSEMENT" else Receipt
    record = session.get(model, ref_id)
    if record is not None:
        record.recon_status = status
        session.flush()


def run(
    session: Session,
    actor: Actor,
    rows: list[StatementRow],
    *,
    settings: Settings | None = None,
) -> ReconResult:
    """匯入流水並比對。只有流水＋金額＋方向＋日期都吻合才可標「已配」。"""
    require(actor, "RECONCILE")
    cfg = settings or get_settings()
    if cfg.allow_amount_only_auto_match:
        raise SlosError(
            ErrorCode.E_AUTO_MATCH_FORBIDDEN,
            detail="設定檔開啟了只靠金額自動配對，規格禁止（丑）。",
        )

    window = dt.timedelta(days=cfg.recon_date_window_days)
    candidates = _candidates(session)
    used: set[tuple[str, int]] = set()
    seen_refs: set[str] = set()
    matched = duplicates = unmatched = no_evidence = 0
    notes: list[str] = []

    for row in rows:
        ref = (row.statement_ref or "").strip() or MISSING
        item = ReconciliationItem(
            ref_type="STATEMENT",
            ref_id=None,
            statement_ref=ref,
            statement_amount=money(row.amount),
            statement_date=row.value_date,
            direction=row.direction,
            note=row.note,
        )
        if ref in seen_refs:
            item.status = ReconStatus.DUPLICATE.value
            duplicates += 1
            session.add(item)
            continue
        seen_refs.add(ref)

        if is_sentinel(ref):
            item.status = ReconStatus.NO_EVIDENCE.value
            item.note = "流水為哨兵詞，無法自動比對；禁止只靠金額配對（丑）。"
            no_evidence += 1
            session.add(item)
            continue

        hit = None
        for ref_type, ref_id, evidence_ref, amount, value_date, direction in candidates:
            if (ref_type, ref_id) in used or is_sentinel(evidence_ref):
                continue
            if (
                evidence_ref.strip() == ref
                and amount == money(row.amount)
                and direction == row.direction
                and abs(value_date - row.value_date) <= window
            ):
                hit = (ref_type, ref_id)
                break

        if hit is None:
            item.status = ReconStatus.UNMATCHED.value
            unmatched += 1
        else:
            item.ref_type, item.ref_id = hit
            item.status = ReconStatus.MATCHED.value
            item.matched_at = dt.datetime.now(dt.timezone.utc)
            item.matched_by = actor.name
            used.add(hit)
            _set_txn_recon_status(session, hit[0], hit[1], ReconStatus.MATCHED.value)
            matched += 1
        session.add(item)

    session.flush()
    for ref_type, ref_id, evidence_ref, _amount, _value_date, _direction in candidates:
        if (ref_type, ref_id) not in used:
            status = (
                ReconStatus.NO_EVIDENCE.value
                if is_sentinel(evidence_ref)
                else ReconStatus.PENDING.value
            )
            _set_txn_recon_status(session, ref_type, ref_id, status)

    notes.append("只靠金額不得自動標「已配」；未配、缺證據一律留在未對帳清單。")
    audit.record(
        session, actor, AuditAction.RECONCILE, "ReconciliationItem", "BATCH",
        detail={"matched": matched, "duplicates": duplicates,
                "unmatched": unmatched, "no_evidence": no_evidence},
    )
    return ReconResult(matched, duplicates, unmatched, no_evidence, notes)


def unreconciled(session: Session) -> list[dict[str, object]]:
    """未對帳清單。儀表板必須列出（D06）。"""
    result: list[dict[str, object]] = []
    for record in session.scalars(
        select(Disbursement).where(
            Disbursement.status == TxnStatus.POSTED.value,
            Disbursement.recon_status != ReconStatus.MATCHED.value,
        )
    ).all():
        result.append({
            "類型": "撥款", "編號": record.id, "交易日": record.txn_date,
            "金額": D(record.amount), "流水": record.evidence_ref,
            "對帳狀態": record.recon_status,
        })
    for record in session.scalars(
        select(Receipt).where(
            Receipt.status == TxnStatus.POSTED.value,
            Receipt.recon_status != ReconStatus.MATCHED.value,
        )
    ).all():
        result.append({
            "類型": "收款", "編號": record.id, "交易日": record.txn_date,
            "金額": D(record.amount), "流水": record.evidence_ref,
            "對帳狀態": record.recon_status,
        })
    return result
