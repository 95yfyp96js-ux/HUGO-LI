"""日結／月結與備份（午／丑）。

開發：每日日結複製 SQLite，留 14 份。正式：Postgres 時間點還原。
Excel 不是備份。
"""
from __future__ import annotations

import datetime as dt
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy.orm import Session

from . import audit, periods, receivable, reporting
from .config import Settings, get_settings
from .enums import AuditAction
from .rbac import Actor, require


@dataclass
class DayCloseResult:
    as_of: dt.date
    snapshots: int
    dashboard: reporting.Dashboard
    checks: list[reporting.ControlCheck]
    backup_path: str
    notes_zh: list[str] = field(default_factory=list)


def day_close(
    session: Session,
    actor: Actor,
    as_of: dt.date,
    *,
    take_snapshots: bool = True,
    settings: Settings | None = None,
) -> DayCloseResult:
    require(actor, "DAY_CLOSE")
    cfg = settings or get_settings()
    count = 0
    if take_snapshots:
        for case in reporting.live_cases(session):
            receivable.snapshot(session, case, as_of, receivable.TRIGGER_DAY_CLOSE)
            count += 1
    board = reporting.dashboard(session, as_of, settings=cfg)
    checks = reporting.control_checks(session, as_of)
    audit.record(
        session, actor, AuditAction.PERIOD_CLOSE, "DayClose", str(as_of),
        detail={"snapshots": count, "failed_checks": [c.name_zh for c in checks if not c.passed]},
    )
    notes = ["Excel 不是備份。備份請用資料庫層級複製或還原點。"]
    if any(not c.passed for c in checks):
        notes.append("控制檢查未全過，請先查明再進行月結。")
    return DayCloseResult(
        as_of=as_of, snapshots=count, dashboard=board, checks=checks,
        backup_path="PENDING", notes_zh=notes,
    )


def month_close(
    session: Session, actor: Actor, as_of: dt.date, *, settings: Settings | None = None
) -> tuple[str, list[reporting.ControlCheck]]:
    require(actor, "MONTH_CLOSE")
    checks = reporting.control_checks(session, as_of)
    period = periods.close(session, as_of, actor)
    return period.period, checks


def backup_sqlite(db_path: str, backup_dir: str, *, settings: Settings | None = None) -> str:
    """開發環境備份：複製 SQLite 檔，只留設定檔指定的份數。"""
    cfg = settings or get_settings()
    source = Path(db_path)
    target_dir = Path(backup_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = target_dir / f"{source.stem}-{stamp}.db"
    shutil.copy2(source, target)

    copies = sorted(target_dir.glob(f"{source.stem}-*.db"))
    for stale in copies[: max(len(copies) - cfg.backup_copies, 0)]:
        stale.unlink()
    return str(target)
