"""帳期（BR-017）。月份已關帳，作業員不得入帳；管理員重開必須寫原因。"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from .enums import AuditAction, PeriodStatus, Role
from .errors import ErrorCode, SlosError
from .models import AccountingPeriod
from .rbac import Actor, require
from . import audit


def period_key(day: dt.date) -> str:
    return f"{day.year:04d}-{day.month:02d}"


def get_or_open(session: Session, day: dt.date) -> AccountingPeriod:
    key = period_key(day)
    found = session.scalar(select(AccountingPeriod).where(AccountingPeriod.period == key))
    if found is None:
        found = AccountingPeriod(period=key, status=PeriodStatus.OPEN.value)
        session.add(found)
        session.flush()
    return found


def assert_open(session: Session, day: dt.date, actor: Actor) -> None:
    period = get_or_open(session, day)
    if period.status == PeriodStatus.CLOSED.value:
        raise SlosError(ErrorCode.E_PERIOD_CLOSED, detail=f"帳期 {period.period}")


def close(session: Session, day: dt.date, actor: Actor) -> AccountingPeriod:
    require(actor, "MONTH_CLOSE")
    period = get_or_open(session, day)
    period.status = PeriodStatus.CLOSED.value
    period.closed_at = dt.datetime.now(dt.timezone.utc)
    period.closed_by = actor.name
    session.flush()
    audit.record(session, actor, AuditAction.PERIOD_CLOSE, "AccountingPeriod", period.period)
    return period


def reopen(session: Session, day: dt.date, actor: Actor, reason: str) -> AccountingPeriod:
    require(actor, "PERIOD_REOPEN")
    if actor.role != Role.ADMIN.value:
        raise SlosError(ErrorCode.E_PERMISSION_DENIED, detail="重開帳期須系統管理員")
    if not reason or not reason.strip():
        raise SlosError(ErrorCode.E_PERIOD_REOPEN_REASON_REQUIRED)
    period = get_or_open(session, day)
    period.status = PeriodStatus.REOPENED.value
    period.reopened_at = dt.datetime.now(dt.timezone.utc)
    period.reopened_by = actor.name
    period.reopen_reason = reason.strip()
    session.flush()
    audit.record(
        session, actor, AuditAction.PERIOD_REOPEN, "AccountingPeriod", period.period,
        detail={"reason": reason.strip()},
    )
    return period
