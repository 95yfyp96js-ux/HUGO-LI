"""帳齡、儀表板、案件頁、分戶、對帳單、控制檢查（丑／巳）。"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import accounts, ledger, pii, positions, receivable, reconciliation
from .config import Settings, get_settings
from .enums import CaseStatus, TxnStatus
from .labels import CASE_STATUS, INTEREST_METHOD, RATE_UNIT
from .models import (
    Allocation, Case, CashMovement, ContractVersion, Customer, Disbursement,
    JournalEntry, JournalLine, Receipt,
)
from .money import D, ZERO, money

LIVE_STATUSES: tuple[str, ...] = (
    CaseStatus.ACTIVE.value, CaseStatus.PARTIALLY_REPAID.value,
    CaseStatus.OVERDUE.value, CaseStatus.EXTENDED.value, CaseStatus.DISBURSED.value,
)


def live_cases(session: Session) -> list[Case]:
    return list(session.scalars(select(Case).where(Case.status.in_(LIVE_STATUSES))).all())


# --------------------------------------------------------------------------
# 帳齡
# --------------------------------------------------------------------------
def _bucket_label(low: int, high: int | None) -> str:
    if low == 0 and high == 0:
        return "未逾期"
    if high is None:
        return f"{low} 以上"
    return f"{low}–{high}"


@dataclass
class AgingRow:
    bucket_zh: str
    case_count: int
    principal: Decimal
    interest: Decimal
    fee: Decimal
    penalty: Decimal

    @property
    def total(self) -> Decimal:
        return money(self.principal + self.interest + self.fee + self.penalty)


def aging(
    session: Session, as_of: dt.date, *, settings: Settings | None = None
) -> tuple[list[AgingRow], Decimal]:
    """帳齡分量分開列。PAR30＝逾期天數 ≥30 的未償本金，不得另定義。"""
    cfg = settings or get_settings()
    rows = {
        _bucket_label(low, high): AgingRow(_bucket_label(low, high), 0, ZERO, ZERO, ZERO, ZERO)
        for low, high in cfg.aging_buckets
    }
    par = ZERO
    for case in live_cases(session):
        view = receivable.compute(session, case, as_of, settings=cfg)
        overdue = view.overdue_days
        label = None
        for low, high in cfg.aging_buckets:
            if low == 0 and high == 0:
                if overdue == 0:
                    label = _bucket_label(low, high)
                    break
                continue
            if overdue >= low and (high is None or overdue <= high):
                label = _bucket_label(low, high)
                break
        if label is None:
            continue
        row = rows[label]
        row.case_count += 1
        row.principal = money(row.principal + view.principal_outstanding)
        row.interest = money(row.interest + view.interest_due)
        row.fee = money(row.fee + view.fee_due)
        row.penalty = money(row.penalty + view.penalty_due)
        if overdue >= cfg.par_overdue_days:
            par = money(par + view.principal_outstanding)
    return list(rows.values()), par


# --------------------------------------------------------------------------
# 儀表板
# --------------------------------------------------------------------------
@dataclass
class Dashboard:
    as_of: dt.date
    due_today_count: int
    due_today_amount: Decimal
    receivable_today: Decimal
    received_today: Decimal
    disbursed_today: Decimal
    overdue_count: int
    overdue_amount: Decimal
    partially_repaid_count: int
    pending_allocation_count: int
    suspense_amount: Decimal
    suspense_aged_count: int
    unreconciled_count: int
    exceptions_zh: list[str] = field(default_factory=list)


def dashboard(
    session: Session, as_of: dt.date, *, settings: Settings | None = None
) -> Dashboard:
    """儀表板第一眼。不要只秀「賺多少」（巳）。"""
    cfg = settings or get_settings()
    due_count = 0
    due_amount = ZERO
    receivable_today = ZERO
    overdue_count = 0
    overdue_amount = ZERO
    partial_count = 0
    exceptions: list[str] = []

    for case in live_cases(session):
        view = receivable.compute(session, case, as_of, settings=cfg)
        receivable_today = money(receivable_today + view.total_due)
        if view.maturity_date == as_of:
            due_count += 1
            due_amount = money(due_amount + view.total_due)
        if view.is_overdue:
            overdue_count += 1
            overdue_amount = money(overdue_amount + view.total_due)
        if case.status == CaseStatus.PARTIALLY_REPAID.value:
            partial_count += 1
        for flag in view.flags:
            exceptions.append(f"{case.case_no}：{flag.label_zh}")
        for warning in view.warnings_zh:
            exceptions.append(f"{case.case_no}：{warning}")

    received_today = money(sum(
        (D(a) for a in session.scalars(
            select(Receipt.amount).where(
                Receipt.txn_date == as_of, Receipt.status == TxnStatus.POSTED.value
            )
        ).all()), ZERO
    ))
    disbursed_today = money(sum(
        (D(a) for a in session.scalars(
            select(Disbursement.amount).where(
                Disbursement.txn_date == as_of, Disbursement.status == TxnStatus.POSTED.value
            )
        ).all()), ZERO
    ))

    pending_allocation = 0
    for receipt in session.scalars(
        select(Receipt).where(Receipt.status == TxnStatus.POSTED.value)
    ).all():
        allocated = session.scalars(
            select(Allocation.id).where(Allocation.receipt_id == receipt.id)
        ).first()
        if allocated is None and receipt.case_id is not None and not receipt.is_recovery:
            pending_allocation += 1

    open_suspense = positions.open_suspense(session)
    suspense_amount = money(sum((D(s.amount) for s in open_suspense), ZERO))
    aged = sum(
        1 for s in open_suspense
        if (as_of - s.opened_date).days > cfg.suspense_alert_days
    )
    if aged:
        exceptions.append(f"暫收超過 {cfg.suspense_alert_days} 日未清：{aged} 筆（丑）。")

    unreconciled = reconciliation.unreconciled(session)
    if unreconciled:
        exceptions.append(f"未對帳交易 {len(unreconciled)} 筆（D06：缺流水仍入帳，但必須列出）。")

    return Dashboard(
        as_of=as_of,
        due_today_count=due_count,
        due_today_amount=due_amount,
        receivable_today=receivable_today,
        received_today=received_today,
        disbursed_today=disbursed_today,
        overdue_count=overdue_count,
        overdue_amount=overdue_amount,
        partially_repaid_count=partial_count,
        pending_allocation_count=pending_allocation,
        suspense_amount=suspense_amount,
        suspense_aged_count=aged,
        unreconciled_count=len(unreconciled),
        exceptions_zh=sorted(set(exceptions)),
    )


# --------------------------------------------------------------------------
# 案件頁
# --------------------------------------------------------------------------
def case_page(
    session: Session, case: Case, as_of: dt.date, *, masked: bool = True,
    settings: Settings | None = None,
) -> dict[str, object]:
    """打開案件三秒內要看到的東西（巳）。個資預設遮蔽。"""
    cfg = settings or get_settings()
    contract: ContractVersion = case.current_contract
    customer = session.get(Customer, case.customer_id)
    view = receivable.compute(session, case, as_of, settings=cfg)
    disbursement_row = session.scalars(
        select(Disbursement).where(
            Disbursement.case_id == case.id, Disbursement.status == TxnStatus.POSTED.value
        )
    ).first()
    pos = positions.position(session, case.id)

    return {
        "案件編號": case.case_no,
        "借款人": pii.mask_name(customer.name) if masked else customer.name,
        "身分證": pii.mask_national_id(customer.national_id) if masked else customer.national_id,
        "本金（契約面額）": D(contract.face_amount),
        "實撥金額": pos.principal_disbursed,
        "撥款日": disbursement_row.txn_date if disbursement_row else "PENDING",
        "借款天數": contract.term_days,
        "到期日": contract.maturity_date,
        "利率值": D(contract.rate_value),
        "利率單位": RATE_UNIT.get(contract.rate_unit, contract.rate_unit),
        "計息方法": INTEREST_METHOD.get(contract.interest_method, contract.interest_method),
        "目前本金": view.principal_outstanding,
        "應收利息（契約原額）": view.interest_contract,
        "應收利息（可執行）": view.interest_enforceable,
        "已收利息": pos.interest_received,
        "未收利息": view.interest_due,
        "應收費用": view.fee_due,
        "應收違約金": view.penalty_due,
        "逾期天數": view.overdue_days,
        "今日應收合計": view.total_due,
        "案件狀態": CASE_STATUS.get(case.status, case.status),
        "契約版本數": len(case.contract_versions),
        "暫收貸方": pos.suspense_credit,
        "遲延利息狀態": view.late_interest_state,
        "合規旗標": [flag.label_zh for flag in view.flags],
        "提醒": view.warnings_zh,
    }


# --------------------------------------------------------------------------
# 分戶與對帳單
# --------------------------------------------------------------------------
def subledger(session: Session, as_of: dt.date) -> list[dict[str, object]]:
    """分戶分量：本金、利息、費用、違約金、暫收貸方。"""
    rows: list[dict[str, object]] = []
    for case in session.scalars(select(Case)).all():
        pos = positions.position(session, case.id)
        rows.append({
            "案件編號": case.case_no,
            "本金": pos.principal_outstanding,
            "已收利息": pos.interest_received,
            "已收費用": pos.fee_received,
            "已收違約金": pos.penalty_received,
            "暫收貸方": pos.suspense_credit,
            "狀態": CASE_STATUS.get(case.status, case.status),
        })
    return rows


def statement(session: Session, case: Case, as_of: dt.date) -> list[dict[str, object]]:
    """案件對帳單：只列已入帳交易，交易日／入帳日分開標示。"""
    rows: list[dict[str, object]] = []
    for record in session.scalars(
        select(Disbursement).where(
            Disbursement.case_id == case.id, Disbursement.txn_date <= as_of
        )
    ).all():
        rows.append({
            "交易日": record.txn_date, "資金日": record.value_date, "類型": "撥款",
            "金額": D(record.amount), "流水": record.evidence_ref,
            "狀態": record.status, "對帳狀態": record.recon_status,
        })
    for record in session.scalars(
        select(Receipt).where(Receipt.case_id == case.id, Receipt.txn_date <= as_of)
    ).all():
        buckets = session.execute(
            select(Allocation.bucket, Allocation.amount).where(
                Allocation.receipt_id == record.id
            )
        ).all()
        rows.append({
            "交易日": record.txn_date, "資金日": record.value_date,
            "類型": "收回" if record.is_recovery else "收款",
            "金額": D(record.amount), "流水": record.evidence_ref,
            "狀態": record.status, "對帳狀態": record.recon_status,
            "沖帳": {b: str(D(a)) for b, a in buckets},
        })
    rows.sort(key=lambda item: (item["交易日"], item["類型"]))
    return rows


# --------------------------------------------------------------------------
# 控制檢查
# --------------------------------------------------------------------------
@dataclass
class ControlCheck:
    name_zh: str
    passed: bool
    detail_zh: str


def control_checks(session: Session, as_of: dt.date) -> list[ControlCheck]:
    """13_控制檢查。通過條件見「未」。"""
    checks: list[ControlCheck] = []

    balanced = ledger.is_balanced(session)
    checks.append(ControlCheck(
        "借貸平衡", balanced,
        "所有分錄借方等於貸方。" if balanced else "有傳票借貸不平，必須查明。",
    ))

    subledger_principal = money(sum(
        (positions.principal_outstanding(session, case.id)
         for case in session.scalars(select(Case)).all()),
        ZERO,
    ))
    account_principal = ledger.account_balance(session, accounts.AR_PRINCIPAL)
    same = subledger_principal == account_principal
    checks.append(ControlCheck(
        "分戶本金等於 1100", same,
        f"分戶合計 {subledger_principal}，科目 1100 {account_principal}。",
    ))

    cash_from_entries = ZERO
    for code in (accounts.CASH, accounts.BANK):
        cash_from_entries = money(cash_from_entries + ledger.account_balance(session, code))
    cash_from_movements = ZERO
    for movement in session.scalars(select(CashMovement)).all():
        signed = D(movement.amount) if movement.direction != "OUT" else -D(movement.amount)
        if movement.direction == "TRANSFER":
            signed = ZERO
        cash_from_movements = money(cash_from_movements + signed)
    rebuildable = cash_from_entries == cash_from_movements
    checks.append(ControlCheck(
        "現金可重建", rebuildable,
        f"分錄現金 {cash_from_entries}，現金帳 {cash_from_movements}。",
    ))

    orphan_lines = session.scalars(
        select(JournalLine.id).where(
            JournalLine.entry_id.not_in(select(JournalEntry.id))
        )
    ).all()
    checks.append(ControlCheck(
        "無孤兒分錄", not orphan_lines, f"孤兒分錄 {len(orphan_lines)} 筆。",
    ))

    keys = session.scalars(select(JournalEntry.idempotency_key)).all()
    duplicated = len(keys) != len(set(keys))
    checks.append(ControlCheck(
        "無重複入帳", not duplicated, f"傳票 {len(keys)} 筆，冪等鍵 {len(set(keys))} 個。",
    ))

    snapshots_ok = True
    detail = "所有快照可重算核對。"
    from .models import ReceivableSnapshot

    for record in session.scalars(select(ReceivableSnapshot)).all():
        case = session.get(Case, record.case_id)
        ok, message = receivable.replay_matches(session, case, record)
        if not ok:
            snapshots_ok = False
            detail = f"{case.case_no}：{message}"
            break
    checks.append(ControlCheck("應收快照可重放", snapshots_ok, detail))

    unreconciled_count = len(reconciliation.unreconciled(session))
    checks.append(ControlCheck(
        "未對帳已揭露", True,
        f"未對帳 {unreconciled_count} 筆，已列入儀表板（缺流水不等於事件不存在）。",
    ))
    return checks
