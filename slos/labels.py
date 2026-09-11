"""列舉代碼 → 繁體中文畫面標籤。

規格：〇　畫面、說明、錯誤訊息、Excel、指令說明一律繁體中文；
資料庫欄位名、API 路徑、列舉代碼維持英文。
"""
from __future__ import annotations

from .enums import (
    AllocationBucket, AuditAction, CaseStatus, ComplianceFlag, ContractSource,
    DayCountCalendar, FundingSource, InterestMethod, PaymentMethod, PeriodStatus,
    RateType, RateUnit, ReconStatus, Role, SettlementQuoteStatus, SuspenseReason,
    TxnStatus, TxnType,
)

ROLE: dict[str, str] = {
    Role.ADMIN: "系統管理員", Role.OPERATOR: "作業員", Role.ACCOUNTING: "帳務",
    Role.READONLY: "唯讀", Role.AUDITOR: "稽核",
}
CASE_STATUS: dict[str, str] = {
    CaseStatus.DRAFT: "草稿", CaseStatus.CANCELLED: "已取消", CaseStatus.DISBURSED: "已撥款",
    CaseStatus.ACTIVE: "進行中", CaseStatus.PARTIALLY_REPAID: "部分已還",
    CaseStatus.OVERDUE: "逾期", CaseStatus.EXTENDED: "已展期",
    CaseStatus.SETTLED: "已結清", CaseStatus.WRITTEN_OFF: "已核銷",
}
TXN_STATUS: dict[str, str] = {
    TxnStatus.DRAFT: "草稿", TxnStatus.POSTED: "已入帳", TxnStatus.REVERSED: "已沖正",
}
TXN_TYPE: dict[str, str] = {
    TxnType.DISBURSEMENT: "撥款", TxnType.RECEIPT: "收款", TxnType.ADJUSTMENT: "調整",
    TxnType.REVERSAL: "沖正", TxnType.WRITEOFF: "核銷", TxnType.RECOVERY: "收回",
}
RATE_UNIT: dict[str, str] = {
    RateUnit.ANNUAL: "年", RateUnit.DAILY: "日", RateUnit.PERIOD: "本期",
    RateUnit.FIXED_AMOUNT: "固定金額",
}
RATE_TYPE: dict[str, str] = {
    RateType.CONTRACT: "契約約定", RateType.STATUTORY: "法定", RateType.NONE: "無息",
}
INTEREST_METHOD: dict[str, str] = {
    InterestMethod.PERIOD_FLAT: "期間定額", InterestMethod.ACT_365: "按日365",
    InterestMethod.ACT_360: "按日360", InterestMethod.CUSTOM: "自訂公式",
}
DAY_COUNT_CALENDAR: dict[str, str] = {DayCountCalendar.CALENDAR: "日曆日"}
PAYMENT_METHOD: dict[str, str] = {
    PaymentMethod.BANK: "銀行", PaymentMethod.CASH: "現金", PaymentMethod.OTHER: "其他",
}
RECON_STATUS: dict[str, str] = {
    ReconStatus.PENDING: "待對", ReconStatus.MATCHED: "已配", ReconStatus.PARTIAL: "部分配",
    ReconStatus.UNMATCHED: "未配", ReconStatus.DUPLICATE: "重複",
    ReconStatus.EXCEPTION: "例外", ReconStatus.NO_EVIDENCE: "缺證據",
}
ALLOCATION_BUCKET: dict[str, str] = {
    AllocationBucket.FEE: "契約費用", AllocationBucket.INTEREST: "利息",
    AllocationBucket.PENALTY: "違約金", AllocationBucket.PRINCIPAL: "本金",
    AllocationBucket.SUSPENSE: "暫收",
}
SUSPENSE_REASON: dict[str, str] = {
    SuspenseReason.OVERPAYMENT: "溢繳", SuspenseReason.UNIDENTIFIED: "無法認列",
    SuspenseReason.METHOD_UNKNOWN: "方式不明", SuspenseReason.CONTRACT_GAP: "契約缺口",
}
CONTRACT_SOURCE: dict[str, str] = {
    ContractSource.INTAKE: "進件", ContractSource.EXTENSION: "展期",
    ContractSource.CORRECTION: "更正",
}
FUNDING_SOURCE: dict[str, str] = {FundingSource.OWNER: "出借人自有資金"}
PERIOD_STATUS: dict[str, str] = {
    PeriodStatus.OPEN: "開帳", PeriodStatus.CLOSED: "已關帳", PeriodStatus.REOPENED: "已重開",
}
SETTLEMENT_QUOTE_STATUS: dict[str, str] = {
    SettlementQuoteStatus.QUOTING: "試算中", SettlementQuoteStatus.EXPIRED: "過期",
    SettlementQuoteStatus.POSTED: "已入帳",
}
COMPLIANCE_FLAG: dict[str, str] = {
    ComplianceFlag.RATE_OVER_205_CAP: "利率逾16",
    ComplianceFlag.CAP_NOT_CONVERTIBLE: "上限無法換算",
    ComplianceFlag.OVER_ONE_YEAR_AND_OVER_204: "滿一年且逾12%",
    ComplianceFlag.POSSIBLE_COMPOUNDING: "可能複利",
    ComplianceFlag.POSSIBLE_DISGUISED_INTEREST: "可能巧取利益",
    ComplianceFlag.EVIDENCE_GAP: "缺證據",
    ComplianceFlag.PENALTY_MAY_BE_REDUCED: "違約金可能被酌減",
    ComplianceFlag.TERM_DAYS_LONG: "天數偏長",
    ComplianceFlag.NEEDS_LEGAL_REVIEW: "需法律審查",
}
AUDIT_ACTION: dict[str, str] = {
    AuditAction.CREATE: "建立", AuditAction.POST: "入帳", AuditAction.REVERSE: "沖正",
    AuditAction.ADJUST: "調整", AuditAction.EXTEND: "展期",
    AuditAction.SETTLE_QUOTE: "結清試算", AuditAction.SETTLE_POST: "結清入帳",
    AuditAction.WRITEOFF: "核銷", AuditAction.RECOVERY: "收回",
    AuditAction.VIEW_FULL_PII: "看完整個資", AuditAction.EXPORT: "匯出",
    AuditAction.PERIOD_CLOSE: "關帳", AuditAction.PERIOD_REOPEN: "重開",
    AuditAction.SETTINGS_CHANGE: "改設定", AuditAction.RECONCILE: "對帳",
    AuditAction.SEGREGATION_WARNING: "單人操作警告",
}

_ALL: tuple[dict[str, str], ...] = (
    ROLE, CASE_STATUS, TXN_STATUS, TXN_TYPE, RATE_UNIT, RATE_TYPE, INTEREST_METHOD,
    DAY_COUNT_CALENDAR, PAYMENT_METHOD, RECON_STATUS, ALLOCATION_BUCKET,
    SUSPENSE_REASON, CONTRACT_SOURCE, FUNDING_SOURCE, PERIOD_STATUS,
    SETTLEMENT_QUOTE_STATUS, COMPLIANCE_FLAG, AUDIT_ACTION,
)


def zh(code: str | None) -> str:
    """任何列舉代碼轉繁中；查不到就原樣回傳。"""
    if code is None:
        return "缺"
    value = code.value if hasattr(code, "value") else str(code)
    for table in _ALL:
        if value in {k.value if hasattr(k, "value") else k for k in table}:
            for key, label in table.items():
                key_value = key.value if hasattr(key, "value") else key
                if key_value == value:
                    return label
    return value
