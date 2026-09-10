"""日期規則。

D01：到期日＝撥款日＋借款天數。2026-09-11＋30＝2026-10-11。
D02：到期當天逾期天數＝0；隔天起算。
D14／BR-021：畫面預設 7／10／15／30；資料庫 1–365；>90 旗標；>365 拒絕。
BR-026：時區台北。日期用日曆日。
"""
from __future__ import annotations

import datetime as dt

from .config import Settings, get_settings
from .errors import ErrorCode, SlosError

MODE_ADD_DAYS = "ADD_DAYS"
MODE_INCLUSIVE = "INCLUSIVE_DISBURSE_DAY"


def taipei_today(now: dt.datetime | None = None) -> dt.date:
    current = now or dt.datetime.now(dt.timezone.utc)
    return (current.astimezone(dt.timezone(dt.timedelta(hours=8)))).date()


def validate_term_days(term_days: int, settings: Settings | None = None) -> int:
    cfg = settings or get_settings()
    if not isinstance(term_days, int) or isinstance(term_days, bool):
        raise SlosError(ErrorCode.E_INVALID_TERM_DAYS, detail=f"{term_days!r}")
    if term_days > cfg.term_days_max:
        raise SlosError(ErrorCode.E_TERM_DAYS_TOO_LONG, detail=f"{term_days} 天")
    if term_days < cfg.term_days_min:
        raise SlosError(ErrorCode.E_INVALID_TERM_DAYS, detail=f"{term_days} 天")
    return term_days


def maturity_date(
    start_date: dt.date, term_days: int, settings: Settings | None = None
) -> dt.date:
    cfg = settings or get_settings()
    validate_term_days(term_days, cfg)
    if cfg.maturity_date_mode == MODE_ADD_DAYS:
        return start_date + dt.timedelta(days=term_days)
    if cfg.maturity_date_mode == MODE_INCLUSIVE:
        return start_date + dt.timedelta(days=term_days - 1)
    raise SlosError(ErrorCode.E_PENDING_DECISION, detail=f"到期日模式 {cfg.maturity_date_mode}")


def overdue_days(maturity: dt.date, as_of: dt.date) -> int:
    """D02：到期當天為 0，隔天起算。"""
    delta = (as_of - maturity).days
    return delta if delta > 0 else 0


def days_between(start: dt.date, end: dt.date) -> int:
    """半開區間 [start, end) 的日曆日數。不得為負。"""
    delta = (end - start).days
    return delta if delta > 0 else 0


def is_long_term(term_days: int, settings: Settings | None = None) -> bool:
    cfg = settings or get_settings()
    return term_days > cfg.term_days_long_flag
