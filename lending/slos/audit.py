"""稽核（寅）。稽核表禁止改、禁止刪。"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from .enums import AuditAction
from .models import AuditLog
from .rbac import Actor


def record(
    session: Session,
    actor: Actor,
    action: AuditAction | str,
    object_type: str,
    object_id: str | int = "N/A",
    detail: dict[str, Any] | str | None = None,
    warning: str = "N/A",
) -> AuditLog:
    payload = detail
    if isinstance(detail, dict):
        payload = json.dumps(detail, ensure_ascii=False, sort_keys=True, default=str)
    log = AuditLog(
        action=action.value if hasattr(action, "value") else str(action),
        actor=actor.name,
        role=actor.role,
        object_type=object_type,
        object_id=str(object_id),
        detail=payload or "N/A",
        warning=warning,
    )
    session.add(log)
    session.flush()
    return log


def record_segregation_warning(
    session: Session, actor: Actor, object_type: str, object_id: str | int, note: str
) -> AuditLog:
    """D08：V1 允許同一人操作與覆核，但必須寫警告稽核。四眼弱。"""
    return record(
        session, actor, AuditAction.SEGREGATION_WARNING, object_type, object_id,
        detail={"note": note},
        warning="單人操作與覆核：四眼原則未達成，請留意內控風險。",
    )
