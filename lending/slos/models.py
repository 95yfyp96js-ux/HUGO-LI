"""資料表定義。欄位名英文（機器識別），說明繁體中文。

規格：戊　案件表禁止「可手改的目前餘額」欄。餘額由已入帳交易推導。
規格：〇-4　已入帳交易不得 UPDATE、不得 DELETE。只能沖正＋更正。
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, event,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from .enums import (
    CaseStatus, ContractSource, DayCountCalendar, FundingSource, PaymentMethod,
    PeriodStatus, RateType, ReconStatus, SettlementQuoteStatus, TxnStatus,
)
from .errors import ErrorCode, SlosError
from .types import MoneyText, RateText


class Base(DeclarativeBase):
    pass


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


# --------------------------------------------------------------------------
# 設定檔
# --------------------------------------------------------------------------
class SettingOverride(Base):
    """設定檔覆寫。改設定必寫稽核。"""

    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(120), unique=True)          # 設定鍵
    value_text: Mapped[str] = mapped_column(Text)                        # 設定值（文字）
    note: Mapped[str] = mapped_column(Text, default="N/A")               # 備註
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_by: Mapped[str] = mapped_column(String(80))


# --------------------------------------------------------------------------
# 客戶／案件／契約版本
# --------------------------------------------------------------------------
class Customer(Base):
    """客戶。個資欄位預設遮蔽顯示，看完整個資必寫稽核。"""

    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    customer_no: Mapped[str] = mapped_column(String(40), unique=True)    # 客戶編號
    name: Mapped[str] = mapped_column(String(120))                       # 姓名
    national_id: Mapped[str] = mapped_column(String(40), default="MISSING")   # 身分證字號
    phone: Mapped[str] = mapped_column(String(40), default="MISSING")         # 電話
    address: Mapped[str] = mapped_column(String(255), default="MISSING")      # 地址
    bank_account: Mapped[str] = mapped_column(String(60), default="MISSING")  # 帳號
    note: Mapped[str] = mapped_column(Text, default="N/A")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str] = mapped_column(String(80))

    cases: Mapped[list["Case"]] = relationship(back_populates="customer")


class Case(Base):
    """案件。建立案件不是核貸（BR-001），沒有核准狀態欄，也沒有可手改的餘額欄。"""

    __tablename__ = "cases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_no: Mapped[str] = mapped_column(String(40), unique=True)        # 案件編號
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    status: Mapped[str] = mapped_column(String(32), default=CaseStatus.DRAFT.value)
    funding_source: Mapped[str] = mapped_column(String(16), default=FundingSource.OWNER.value)
    opened_date: Mapped[dt.date] = mapped_column(Date)                   # 建立日
    closed_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    note: Mapped[str] = mapped_column(Text, default="N/A")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str] = mapped_column(String(80))

    customer: Mapped[Customer] = relationship(back_populates="cases")
    contract_versions: Mapped[list["ContractVersion"]] = relationship(
        back_populates="case", order_by="ContractVersion.version_no"
    )

    @property
    def current_contract(self) -> "ContractVersion":
        for version in self.contract_versions:
            if version.is_current:
                return version
        raise SlosError(ErrorCode.E_CONTRACT_NOT_FOUND, detail=self.case_no)


class ContractVersion(Base):
    """契約版本。改利率、天數、計息、違約金、沖帳覆寫＝新版本（BR-004）。"""

    __tablename__ = "contract_versions"
    __table_args__ = (UniqueConstraint("case_id", "version_no", name="uq_contract_case_version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"))
    version_no: Mapped[int] = mapped_column(Integer)                     # 版本序號
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)      # 是否目前版本

    face_amount: Mapped[Decimal] = mapped_column(MoneyText)              # 契約面額
    term_days: Mapped[int] = mapped_column(Integer)                      # 借款天數
    rate_type: Mapped[str] = mapped_column(String(16), default=RateType.CONTRACT.value)
    rate_value: Mapped[Decimal] = mapped_column(RateText)                # 利率值
    rate_unit: Mapped[str] = mapped_column(String(16))                   # 利率單位
    interest_method: Mapped[str] = mapped_column(String(16))             # 計息方法
    day_count_calendar: Mapped[str] = mapped_column(
        String(16), default=DayCountCalendar.CALENDAR.value
    )
    period_flat_amount: Mapped[Decimal | None] = mapped_column(MoneyText, nullable=True)
    sticky_interest: Mapped[bool] = mapped_column(Boolean, default=False)  # 固定利息不隨本金減少
    rounding_mode: Mapped[str] = mapped_column(String(24), default="ROUND_HALF_UP")

    fee_rule: Mapped[str] = mapped_column(Text, default="N/A")           # 費用規則
    penalty_rule: Mapped[str] = mapped_column(Text, default="N/A")       # 違約金規則
    late_interest_rule: Mapped[str] = mapped_column(Text, default="N/A")  # 遲延利息規則
    allocation_override: Mapped[str] = mapped_column(Text, default="N/A")  # 沖帳覆寫

    fee_amount: Mapped[Decimal] = mapped_column(MoneyText, default=Decimal("0.00"))
    penalty_amount: Mapped[Decimal] = mapped_column(MoneyText, default=Decimal("0.00"))

    source: Mapped[str] = mapped_column(String(16), default=ContractSource.INTAKE.value)
    effective_date: Mapped[dt.date] = mapped_column(Date)                # 起算日（撥款日或展期起日）
    maturity_date: Mapped[dt.date] = mapped_column(Date)                 # 到期日
    contract_ref: Mapped[str] = mapped_column(String(80), default="MISSING")  # 借據編號
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str] = mapped_column(String(80))

    case: Mapped[Case] = relationship(back_populates="contract_versions")


# --------------------------------------------------------------------------
# 傳票／分錄／現金帳
# --------------------------------------------------------------------------
class JournalEntry(Base):
    """傳票。每筆入帳必須有借貸分錄（D15）。已入帳不得修改或刪除。"""

    __tablename__ = "journal_entries"
    __table_args__ = (
        UniqueConstraint("ledger_code", "idempotency_key", name="uq_ledger_idempotency"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entry_no: Mapped[str] = mapped_column(String(40), unique=True)       # 傳票號
    ledger_code: Mapped[str] = mapped_column(String(32), default="MAIN")  # 帳本代碼
    idempotency_key: Mapped[str] = mapped_column(String(120))            # 冪等鍵
    txn_type: Mapped[str] = mapped_column(String(24))                    # 交易類型
    txn_date: Mapped[dt.date] = mapped_column(Date)                      # 交易日
    value_date: Mapped[dt.date] = mapped_column(Date)                    # 資金日
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id"), nullable=True)
    memo: Mapped[str] = mapped_column(Text, default="N/A")
    reverses_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("journal_entries.id"), nullable=True
    )
    posted_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str] = mapped_column(String(80))

    lines: Mapped[list["JournalLine"]] = relationship(
        back_populates="entry", order_by="JournalLine.id"
    )


class JournalLine(Base):
    """分錄。借貸不平衡不得入帳。"""

    __tablename__ = "journal_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("journal_entries.id"))
    account_code: Mapped[str] = mapped_column(String(8))                 # 科目代碼
    debit: Mapped[Decimal] = mapped_column(MoneyText, default=Decimal("0.00"))
    credit: Mapped[Decimal] = mapped_column(MoneyText, default=Decimal("0.00"))
    subledger_bucket: Mapped[str] = mapped_column(String(16), default="N/A")  # 分戶分量
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id"), nullable=True)
    memo: Mapped[str] = mapped_column(Text, default="N/A")

    entry: Mapped[JournalEntry] = relationship(back_populates="lines")


class CashMovement(Base):
    """現金帳。轉帳淨額為零，不是收入。"""

    __tablename__ = "cash_movements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("journal_entries.id"))
    account_code: Mapped[str] = mapped_column(String(8))
    direction: Mapped[str] = mapped_column(String(10))                   # IN／OUT／TRANSFER
    amount: Mapped[Decimal] = mapped_column(MoneyText)
    txn_date: Mapped[dt.date] = mapped_column(Date)
    value_date: Mapped[dt.date] = mapped_column(Date)
    memo: Mapped[str] = mapped_column(Text, default="N/A")


# --------------------------------------------------------------------------
# 撥款／收款／沖帳
# --------------------------------------------------------------------------
class Disbursement(Base):
    """撥款。帳上本金以實撥為準（BR-005）。"""

    __tablename__ = "disbursements"
    __table_args__ = (UniqueConstraint("idempotency_key", name="uq_disbursement_idem"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"))
    contract_version_id: Mapped[int] = mapped_column(ForeignKey("contract_versions.id"))
    txn_date: Mapped[dt.date] = mapped_column(Date)                      # 交易日
    value_date: Mapped[dt.date] = mapped_column(Date)                    # 資金日
    amount: Mapped[Decimal] = mapped_column(MoneyText)                   # 實撥金額
    method: Mapped[str] = mapped_column(String(10), default=PaymentMethod.BANK.value)
    evidence_ref: Mapped[str] = mapped_column(String(120), default="MISSING")  # 流水
    idempotency_key: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(12), default=TxnStatus.DRAFT.value)
    recon_status: Mapped[str] = mapped_column(String(16), default=ReconStatus.PENDING.value)
    journal_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("journal_entries.id"), nullable=True
    )
    posted_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str] = mapped_column(String(80))


class Receipt(Base):
    """收款（實收）。實收 ≠ 沖帳。"""

    __tablename__ = "receipts"
    __table_args__ = (UniqueConstraint("idempotency_key", name="uq_receipt_idem"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id"), nullable=True)
    txn_date: Mapped[dt.date] = mapped_column(Date)
    value_date: Mapped[dt.date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(MoneyText)
    method: Mapped[str] = mapped_column(String(10), default=PaymentMethod.BANK.value)
    evidence_ref: Mapped[str] = mapped_column(String(120), default="MISSING")
    idempotency_key: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(12), default=TxnStatus.DRAFT.value)
    recon_status: Mapped[str] = mapped_column(String(16), default=ReconStatus.PENDING.value)
    payer_designation: Mapped[str] = mapped_column(Text, default="N/A")  # 付款人指定
    is_recovery: Mapped[bool] = mapped_column(Boolean, default=False)    # 核銷後收回
    journal_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("journal_entries.id"), nullable=True
    )
    posted_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str] = mapped_column(String(80))


class Allocation(Base):
    """沖帳。每一筆沖帳列必須記下當時規則編號（癸）。"""

    __tablename__ = "allocations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    receipt_id: Mapped[int] = mapped_column(ForeignKey("receipts.id"))
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id"), nullable=True)
    sequence: Mapped[int] = mapped_column(Integer)
    bucket: Mapped[str] = mapped_column(String(16))                      # 分量
    amount: Mapped[Decimal] = mapped_column(MoneyText)
    rule_code: Mapped[str] = mapped_column(String(24))                   # 規則編號
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


# --------------------------------------------------------------------------
# 應收快照
# --------------------------------------------------------------------------
class ReceivableSnapshot(Base):
    """應收。只在事件落地快照（辛），不做每天排程產快照。"""

    __tablename__ = "receivable_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"))
    contract_version_id: Mapped[int] = mapped_column(ForeignKey("contract_versions.id"))
    as_of_date: Mapped[dt.date] = mapped_column(Date)                    # 基準日
    trigger_event: Mapped[str] = mapped_column(String(32))               # 觸發事件
    entry_cutoff_id: Mapped[int] = mapped_column(Integer, default=0)     # 傳票序號切點（供重放）
    principal_outstanding: Mapped[Decimal] = mapped_column(MoneyText)
    interest_contract: Mapped[Decimal] = mapped_column(MoneyText)        # 契約原額利息
    interest_enforceable: Mapped[Decimal] = mapped_column(MoneyText)     # 可執行利息
    interest_received: Mapped[Decimal] = mapped_column(MoneyText)
    interest_due: Mapped[Decimal] = mapped_column(MoneyText)
    fee_due: Mapped[Decimal] = mapped_column(MoneyText)
    penalty_due: Mapped[Decimal] = mapped_column(MoneyText)
    total_due: Mapped[Decimal] = mapped_column(MoneyText)
    overdue_days: Mapped[int] = mapped_column(Integer, default=0)
    flags: Mapped[str] = mapped_column(Text, default="N/A")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


# --------------------------------------------------------------------------
# 證據／暫收／展期／結清／調整／核銷／對帳／帳期／稽核／旗標
# --------------------------------------------------------------------------
class ExternalEvidence(Base):
    """外部證據。銀行只是外部資金證據，缺流水不等於事件不存在（BR-018）。"""

    __tablename__ = "external_evidence"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id"), nullable=True)
    ref_type: Mapped[str] = mapped_column(String(24))                    # DISBURSEMENT／RECEIPT
    ref_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    evidence_type: Mapped[str] = mapped_column(String(24), default="BANK_STATEMENT")
    evidence_ref: Mapped[str] = mapped_column(String(120), default="MISSING")
    amount: Mapped[Decimal | None] = mapped_column(MoneyText, nullable=True)
    value_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    verified: Mapped[str] = mapped_column(String(16), default="NOT_VERIFIED")
    note: Mapped[str] = mapped_column(Text, default="N/A")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class SuspenseEntry(Base):
    """暫收。溢繳進暫收，不是收入，也不是負本金（BR-013）。"""

    __tablename__ = "suspense_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    receipt_id: Mapped[int] = mapped_column(ForeignKey("receipts.id"))
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id"), nullable=True)
    amount: Mapped[Decimal] = mapped_column(MoneyText)
    reason: Mapped[str] = mapped_column(String(24))
    opened_date: Mapped[dt.date] = mapped_column(Date)
    cleared_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    note: Mapped[str] = mapped_column(Text, default="N/A")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Extension(Base):
    """展期。同一案件編號，新契約版本，保留歷史（BR-022）。"""

    __tablename__ = "extensions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"))
    from_contract_version_id: Mapped[int] = mapped_column(ForeignKey("contract_versions.id"))
    to_contract_version_id: Mapped[int] = mapped_column(ForeignKey("contract_versions.id"))
    requested_date: Mapped[dt.date] = mapped_column(Date)
    new_term_days: Mapped[int] = mapped_column(Integer)
    new_maturity_date: Mapped[dt.date] = mapped_column(Date)
    capitalize_interest: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str] = mapped_column(String(80))


class SettlementQuote(Base):
    """結清報價。結清試算 ≠ 已結清（BR-028）。"""

    __tablename__ = "settlement_quotes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"))
    quote_no: Mapped[str] = mapped_column(String(40), unique=True)
    as_of_date: Mapped[dt.date] = mapped_column(Date)
    valid_until: Mapped[dt.date] = mapped_column(Date)
    principal: Mapped[Decimal] = mapped_column(MoneyText)
    interest: Mapped[Decimal] = mapped_column(MoneyText)
    fee: Mapped[Decimal] = mapped_column(MoneyText)
    penalty: Mapped[Decimal] = mapped_column(MoneyText)
    total: Mapped[Decimal] = mapped_column(MoneyText)
    status: Mapped[str] = mapped_column(String(12), default=SettlementQuoteStatus.QUOTING.value)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str] = mapped_column(String(80))


class Settlement(Base):
    """結清入帳。尾差小於容差才把案件轉已結清。"""

    __tablename__ = "settlements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"))
    quote_id: Mapped[int] = mapped_column(ForeignKey("settlement_quotes.id"))
    receipt_id: Mapped[int] = mapped_column(ForeignKey("receipts.id"))
    residual: Mapped[Decimal] = mapped_column(MoneyText)
    posted_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str] = mapped_column(String(80))


class Adjustment(Base):
    """調整。調整永遠新增。利息轉本金預設拒絕（BR-011）。"""

    __tablename__ = "adjustments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id"), nullable=True)
    adjust_type: Mapped[str] = mapped_column(String(32))
    amount: Mapped[Decimal] = mapped_column(MoneyText)
    reason: Mapped[str] = mapped_column(Text)
    approved_by: Mapped[str] = mapped_column(String(80), default="N/A")
    legal_review_required: Mapped[bool] = mapped_column(Boolean, default=False)
    journal_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("journal_entries.id"), nullable=True
    )
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str] = mapped_column(String(80))


class WriteOff(Base):
    """核銷。核銷不刪案件，之後收款＝收回（BR-024）。"""

    __tablename__ = "writeoffs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"))
    amount: Mapped[Decimal] = mapped_column(MoneyText)
    reason: Mapped[str] = mapped_column(Text)
    approved_by: Mapped[str] = mapped_column(String(80))
    journal_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("journal_entries.id"), nullable=True
    )
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_by: Mapped[str] = mapped_column(String(80))


class ReconciliationItem(Base):
    """對帳。禁止只靠金額自動標已配（丑）。"""

    __tablename__ = "reconciliation_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ref_type: Mapped[str] = mapped_column(String(24))
    ref_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    statement_ref: Mapped[str] = mapped_column(String(120), default="MISSING")
    statement_amount: Mapped[Decimal | None] = mapped_column(MoneyText, nullable=True)
    statement_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    direction: Mapped[str] = mapped_column(String(10), default="UNKNOWN")
    status: Mapped[str] = mapped_column(String(16), default=ReconStatus.PENDING.value)
    matched_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    matched_by: Mapped[str] = mapped_column(String(80), default="N/A")
    note: Mapped[str] = mapped_column(Text, default="N/A")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AccountingPeriod(Base):
    """帳期。月份已關帳，作業員不得入帳（BR-017）。"""

    __tablename__ = "accounting_periods"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    period: Mapped[str] = mapped_column(String(7), unique=True)          # YYYY-MM
    status: Mapped[str] = mapped_column(String(12), default=PeriodStatus.OPEN.value)
    closed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_by: Mapped[str] = mapped_column(String(80), default="N/A")
    reopened_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reopened_by: Mapped[str] = mapped_column(String(80), default="N/A")
    reopen_reason: Mapped[str] = mapped_column(Text, default="N/A")


class AuditLog(Base):
    """稽核。稽核表禁止改、禁止刪（寅）。"""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    action: Mapped[str] = mapped_column(String(32))
    actor: Mapped[str] = mapped_column(String(80))
    role: Mapped[str] = mapped_column(String(16))
    object_type: Mapped[str] = mapped_column(String(40))
    object_id: Mapped[str] = mapped_column(String(60), default="N/A")
    detail: Mapped[str] = mapped_column(Text, default="N/A")
    warning: Mapped[str] = mapped_column(Text, default="N/A")
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ComplianceFlagRecord(Base):
    """合規旗標。旗標不是判決，不得自動宣告借貸無效、不得自動入罪。"""

    __tablename__ = "compliance_flags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id"), nullable=True)
    contract_version_id: Mapped[int | None] = mapped_column(
        ForeignKey("contract_versions.id"), nullable=True
    )
    flag: Mapped[str] = mapped_column(String(40))
    detail: Mapped[str] = mapped_column(Text, default="N/A")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


# --------------------------------------------------------------------------
# 不可變性強制
# --------------------------------------------------------------------------
#: 已入帳後完全不可改、不可刪的資料表
APPEND_ONLY_MODELS: tuple[type[Base], ...] = (
    JournalEntry, JournalLine, CashMovement, Allocation, AuditLog,
    ReceivableSnapshot, ComplianceFlagRecord,
)

#: 交易類資料表：草稿可改；一旦已入帳，只允許白名單欄位（對帳狀態）變動，且必寫稽核
POSTED_GUARDED_MODELS: tuple[type[Base], ...] = (Disbursement, Receipt)
#: 已入帳後仍可異動的欄位。對帳狀態不是金額，也不是契約內容，異動一律寫稽核。
POSTED_MUTABLE_FIELDS: frozenset[str] = frozenset({"recon_status"})
#: 草稿 → 已入帳這一步允許寫入的欄位（己：草稿 → 已入帳 → 已沖正）
POSTING_FIELDS: frozenset[str] = frozenset({"status", "journal_entry_id", "posted_at"})


def _changed_fields(obj: Any) -> set[str]:
    from sqlalchemy import inspect as sa_inspect

    state = sa_inspect(obj)
    changed: set[str] = set()
    for attr in state.attrs:
        history = attr.load_history()
        if history.has_changes():
            changed.add(attr.key)
    return changed


def _previous_status(obj: Any) -> str | None:
    from sqlalchemy import inspect as sa_inspect

    history = sa_inspect(obj).attrs["status"].load_history()
    if history.deleted:
        return history.deleted[0]
    if history.unchanged:
        return history.unchanged[0]
    return None


@event.listens_for(Base, "before_update", propagate=True)
def _block_update(mapper, connection, target):  # noqa: ANN001, ARG001
    if isinstance(target, APPEND_ONLY_MODELS):
        code = (
            ErrorCode.E_AUDIT_IMMUTABLE
            if isinstance(target, AuditLog)
            else ErrorCode.E_IMMUTABLE_POSTED
        )
        raise SlosError(code, detail=f"{type(target).__name__} 為只能追加的資料表")
    if isinstance(target, POSTED_GUARDED_MODELS):
        previous = _previous_status(target)
        changed = _changed_fields(target)
        if previous == TxnStatus.DRAFT.value:
            # 草稿轉已入帳：只允許寫入入帳欄位，金額與契約內容此時不得再動。
            illegal = changed - POSTING_FIELDS - POSTED_MUTABLE_FIELDS
            if illegal:
                raise SlosError(
                    ErrorCode.E_IMMUTABLE_POSTED,
                    detail=f"{type(target).__name__} 入帳時不得同時修改 {sorted(illegal)}",
                )
        elif previous == TxnStatus.POSTED.value:
            illegal = changed - POSTED_MUTABLE_FIELDS
            if illegal:
                raise SlosError(
                    ErrorCode.E_IMMUTABLE_POSTED,
                    detail=f"{type(target).__name__} 已入帳，欄位 {sorted(illegal)} 不得修改",
                )


@event.listens_for(Base, "before_delete", propagate=True)
def _block_delete(mapper, connection, target):  # noqa: ANN001, ARG001
    if isinstance(target, AuditLog):
        raise SlosError(ErrorCode.E_AUDIT_IMMUTABLE)
    if isinstance(target, APPEND_ONLY_MODELS):
        raise SlosError(ErrorCode.E_DELETE_FORBIDDEN, detail=type(target).__name__)
    if isinstance(target, POSTED_GUARDED_MODELS) and target.status != TxnStatus.DRAFT.value:
        raise SlosError(ErrorCode.E_DELETE_FORBIDDEN, detail="已入帳交易不得刪除")


def create_all(engine: Any) -> None:
    Base.metadata.create_all(engine)
