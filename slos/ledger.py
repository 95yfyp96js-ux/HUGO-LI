"""帳本。金額唯一真相：資料庫只能追加的帳本。

規格：〇-4　已入帳交易不得 UPDATE、不得 DELETE。只能沖正＋更正。
規格：D15　每筆入帳必須有借貸分錄。
規格：BR-015　同一帳本＋同一冪等鍵不得重複入帳。
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import accounts, audit, periods
from .enums import AuditAction, TxnType
from .errors import ErrorCode, SlosError
from .models import CashMovement, JournalEntry, JournalLine
from .money import ZERO, money
from .rbac import Actor

MAIN_LEDGER = "MAIN"


@dataclass
class Line:
    """一筆分錄。debit 與 credit 只能擇一為正。"""

    account_code: str
    debit: Decimal = ZERO
    credit: Decimal = ZERO
    bucket: str = "N/A"
    case_id: int | None = None
    memo: str = "N/A"


@dataclass
class PostResult:
    entry: JournalEntry
    duplicate: bool = False
    message_zh: str = "已入帳。"
    warnings: list[str] = field(default_factory=list)


def _next_entry_no(session: Session, txn_date: dt.date) -> str:
    prefix = f"JE{txn_date:%Y%m%d}"
    used = session.scalar(
        select(func.count(JournalEntry.id)).where(JournalEntry.entry_no.like(f"{prefix}%"))
    ) or 0
    return f"{prefix}-{used + 1:04d}"


def _validate(lines: list[Line]) -> tuple[Decimal, Decimal]:
    if not lines:
        raise SlosError(ErrorCode.E_UNBALANCED_ENTRY, detail="沒有任何分錄")
    debit_total = ZERO
    credit_total = ZERO
    for line in lines:
        accounts.get(line.account_code)
        debit = money(line.debit)
        credit = money(line.credit)
        if debit < 0 or credit < 0:
            raise SlosError(ErrorCode.E_NEGATIVE_AMOUNT, detail=f"科目 {line.account_code}")
        if debit > 0 and credit > 0:
            raise SlosError(
                ErrorCode.E_UNBALANCED_ENTRY,
                detail=f"科目 {line.account_code} 同時有借方與貸方",
            )
        if debit == 0 and credit == 0:
            raise SlosError(
                ErrorCode.E_UNBALANCED_ENTRY, detail=f"科目 {line.account_code} 金額為零"
            )
        debit_total += debit
        credit_total += credit
    if debit_total != credit_total:
        raise SlosError(
            ErrorCode.E_UNBALANCED_ENTRY,
            detail=f"借方 {debit_total} 與貸方 {credit_total} 不相等",
        )
    return debit_total, credit_total


def _write_cash_movements(session: Session, entry: JournalEntry, lines: list[Line]) -> None:
    cash_lines = [ln for ln in lines if accounts.get(ln.account_code).is_cash]
    if not cash_lines:
        return
    has_in = any(money(ln.debit) > 0 for ln in cash_lines)
    has_out = any(money(ln.credit) > 0 for ln in cash_lines)
    is_transfer = has_in and has_out
    for line in cash_lines:
        debit = money(line.debit)
        credit = money(line.credit)
        direction = "TRANSFER" if is_transfer else ("IN" if debit > 0 else "OUT")
        session.add(
            CashMovement(
                entry_id=entry.id,
                account_code=line.account_code,
                direction=direction,
                amount=debit if debit > 0 else credit,
                txn_date=entry.txn_date,
                value_date=entry.value_date,
                memo=line.memo,
            )
        )


def find_by_idempotency(
    session: Session, idempotency_key: str, ledger_code: str = MAIN_LEDGER
) -> JournalEntry | None:
    return session.scalar(
        select(JournalEntry).where(
            JournalEntry.ledger_code == ledger_code,
            JournalEntry.idempotency_key == idempotency_key,
        )
    )


def post(
    session: Session,
    actor: Actor,
    *,
    txn_type: TxnType | str,
    txn_date: dt.date,
    value_date: dt.date,
    lines: list[Line],
    idempotency_key: str,
    case_id: int | None = None,
    memo: str = "N/A",
    ledger_code: str = MAIN_LEDGER,
    reverses_entry_id: int | None = None,
    skip_period_check: bool = False,
) -> PostResult:
    """入帳。檢核 → 借貸平衡 → 冪等 → 帳期 → 寫傳票與現金帳 → 稽核。"""
    if not idempotency_key or not idempotency_key.strip():
        raise SlosError(ErrorCode.E_IDEMPOTENCY_KEY_REQUIRED)
    key = idempotency_key.strip()

    existing = find_by_idempotency(session, key, ledger_code)
    if existing is not None:
        return PostResult(
            entry=existing,
            duplicate=True,
            message_zh="相同冪等鍵已入帳，本次不重複記帳。",
        )

    _validate(lines)
    if not skip_period_check:
        periods.assert_open(session, txn_date, actor)

    entry = JournalEntry(
        entry_no=_next_entry_no(session, txn_date),
        ledger_code=ledger_code,
        idempotency_key=key,
        txn_type=txn_type.value if hasattr(txn_type, "value") else str(txn_type),
        txn_date=txn_date,
        value_date=value_date,
        case_id=case_id,
        memo=memo,
        reverses_entry_id=reverses_entry_id,
        created_by=actor.name,
    )
    session.add(entry)
    session.flush()

    for line in lines:
        session.add(
            JournalLine(
                entry_id=entry.id,
                account_code=line.account_code,
                debit=money(line.debit),
                credit=money(line.credit),
                subledger_bucket=line.bucket,
                case_id=line.case_id if line.case_id is not None else case_id,
                memo=line.memo,
            )
        )
    session.flush()
    _write_cash_movements(session, entry, lines)
    session.flush()

    audit.record(
        session, actor, AuditAction.POST, "JournalEntry", entry.entry_no,
        detail={"txn_type": entry.txn_type, "idempotency_key": key, "case_id": case_id},
    )
    return PostResult(entry=entry)


def reverse(
    session: Session,
    actor: Actor,
    entry: JournalEntry,
    *,
    idempotency_key: str,
    reason: str,
    txn_date: dt.date | None = None,
) -> PostResult:
    """沖正產生反向分錄，原列由是否存在沖正傳票衍生判斷，不就地覆寫（寅）。"""
    if is_reversed(session, entry):
        raise SlosError(ErrorCode.E_ALREADY_REVERSED, detail=entry.entry_no)
    mirrored = [
        Line(
            account_code=line.account_code,
            debit=line.credit,
            credit=line.debit,
            bucket=line.subledger_bucket,
            case_id=line.case_id,
            memo=f"沖正 {entry.entry_no}：{reason}",
        )
        for line in entry.lines
    ]
    result = post(
        session, actor,
        txn_type=TxnType.REVERSAL,
        txn_date=txn_date or entry.txn_date,
        value_date=entry.value_date,
        lines=mirrored,
        idempotency_key=idempotency_key,
        case_id=entry.case_id,
        memo=f"沖正 {entry.entry_no}：{reason}",
        reverses_entry_id=entry.id,
    )
    audit.record(
        session, actor, AuditAction.REVERSE, "JournalEntry", entry.entry_no,
        detail={"reason": reason, "reversal_entry": result.entry.entry_no},
    )
    result.message_zh = f"已沖正傳票 {entry.entry_no}。"
    return result


def is_reversed(session: Session, entry: JournalEntry) -> bool:
    return session.scalar(
        select(func.count(JournalEntry.id)).where(JournalEntry.reverses_entry_id == entry.id)
    ) > 0


def max_entry_id(session: Session) -> int:
    """目前帳本的最後一筆傳票序號。快照用它當重放切點（辛）。"""
    return int(session.scalar(select(func.coalesce(func.max(JournalEntry.id), 0))) or 0)


def account_balance(
    session: Session, account_code: str, *, case_id: int | None = None,
    as_of: dt.date | None = None, entry_cutoff_id: int | None = None,
) -> Decimal:
    """科目餘額＝借方減貸方（借餘科目取正號）。餘額一律由已入帳分錄推導。

    entry_cutoff_id 用來重放歷史快照：同一天內的先後順序靠傳票序號還原。
    """
    query = (
        select(JournalLine.debit, JournalLine.credit)
        .join(JournalEntry, JournalEntry.id == JournalLine.entry_id)
        .where(JournalLine.account_code == account_code)
    )
    if case_id is not None:
        query = query.where(JournalLine.case_id == case_id)
    if as_of is not None:
        query = query.where(JournalEntry.txn_date <= as_of)
    if entry_cutoff_id is not None:
        query = query.where(JournalEntry.id <= entry_cutoff_id)

    account = accounts.get(account_code)
    total = ZERO
    for debit, credit in session.execute(query).all():
        total += debit - credit
    return money(total if account.normal_side == accounts.DEBIT else -total)


def trial_balance(session: Session) -> dict[str, Decimal]:
    """試算表。借貸必須平。"""
    result: dict[str, Decimal] = {}
    rows = session.execute(select(JournalLine.account_code, JournalLine.debit, JournalLine.credit)).all()
    for code, debit, credit in rows:
        result[code] = result.get(code, ZERO) + (debit - credit)
    return {code: money(value) for code, value in sorted(result.items())}


def is_balanced(session: Session) -> bool:
    total = sum(trial_balance(session).values(), ZERO)
    return money(total) == ZERO
