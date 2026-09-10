"""列舉代碼維持英文（機器識別），畫面標籤見 labels.py。"""
from __future__ import annotations

from enum import Enum


class Role(str, Enum):
    ADMIN = "ADMIN"          # 系統管理員
    OPERATOR = "OPERATOR"    # 作業員
    ACCOUNTING = "ACCOUNTING"  # 帳務
    READONLY = "READONLY"    # 唯讀
    AUDITOR = "AUDITOR"      # 稽核


class CaseStatus(str, Enum):
    DRAFT = "DRAFT"                    # 草稿
    CANCELLED = "CANCELLED"            # 已取消
    DISBURSED = "DISBURSED"            # 已撥款
    ACTIVE = "ACTIVE"                  # 進行中
    PARTIALLY_REPAID = "PARTIALLY_REPAID"  # 部分已還
    OVERDUE = "OVERDUE"                # 逾期
    EXTENDED = "EXTENDED"              # 已展期
    SETTLED = "SETTLED"                # 已結清
    WRITTEN_OFF = "WRITTEN_OFF"        # 已核銷


class TxnStatus(str, Enum):
    DRAFT = "DRAFT"        # 草稿
    POSTED = "POSTED"      # 已入帳
    REVERSED = "REVERSED"  # 已沖正（衍生狀態，不就地覆寫）


class TxnType(str, Enum):
    DISBURSEMENT = "DISBURSEMENT"  # 撥款
    RECEIPT = "RECEIPT"            # 收款
    ADJUSTMENT = "ADJUSTMENT"      # 調整
    REVERSAL = "REVERSAL"          # 沖正
    WRITEOFF = "WRITEOFF"          # 核銷
    RECOVERY = "RECOVERY"          # 收回


class RateUnit(str, Enum):
    ANNUAL = "ANNUAL"              # 年
    DAILY = "DAILY"                # 日
    PERIOD = "PERIOD"              # 本期
    FIXED_AMOUNT = "FIXED_AMOUNT"  # 固定金額


class RateType(str, Enum):
    CONTRACT = "CONTRACT"    # 契約約定
    STATUTORY = "STATUTORY"  # 法定（無約定時另依法處理，V1 不自動套用）
    NONE = "NONE"            # 無息


class InterestMethod(str, Enum):
    PERIOD_FLAT = "PERIOD_FLAT"  # 期間定額
    ACT_365 = "ACT_365"          # 按日 365
    ACT_360 = "ACT_360"          # 按日 360
    CUSTOM = "CUSTOM"            # 自訂公式（V1 拒絕）


class DayCountCalendar(str, Enum):
    CALENDAR = "CALENDAR"  # 日曆日


class PaymentMethod(str, Enum):
    BANK = "BANK"    # 銀行
    CASH = "CASH"    # 現金
    OTHER = "OTHER"  # 其他


class ReconStatus(str, Enum):
    PENDING = "PENDING"          # 待對
    MATCHED = "MATCHED"          # 已配
    PARTIAL = "PARTIAL"          # 部分配
    UNMATCHED = "UNMATCHED"      # 未配
    DUPLICATE = "DUPLICATE"      # 重複
    EXCEPTION = "EXCEPTION"      # 例外
    NO_EVIDENCE = "NO_EVIDENCE"  # 缺證據


class AllocationBucket(str, Enum):
    FEE = "FEE"              # 契約費用
    INTEREST = "INTEREST"    # 利息
    PENALTY = "PENALTY"      # 違約金
    PRINCIPAL = "PRINCIPAL"  # 本金
    SUSPENSE = "SUSPENSE"    # 暫收


class SuspenseReason(str, Enum):
    OVERPAYMENT = "OVERPAYMENT"          # 溢繳
    UNIDENTIFIED = "UNIDENTIFIED"        # 無法認列
    METHOD_UNKNOWN = "METHOD_UNKNOWN"    # 方式不明
    CONTRACT_GAP = "CONTRACT_GAP"        # 契約缺口


class ContractSource(str, Enum):
    INTAKE = "INTAKE"        # 進件
    EXTENSION = "EXTENSION"  # 展期
    CORRECTION = "CORRECTION"  # 更正


class FundingSource(str, Enum):
    OWNER = "OWNER"  # 出借人自有資金。D10：V1 只有這一種。


class PeriodStatus(str, Enum):
    OPEN = "OPEN"        # 開帳
    CLOSED = "CLOSED"    # 已關帳
    REOPENED = "REOPENED"  # 已重開


class SettlementQuoteStatus(str, Enum):
    QUOTING = "QUOTING"  # 試算中
    EXPIRED = "EXPIRED"  # 過期
    POSTED = "POSTED"    # 已入帳


class ComplianceFlag(str, Enum):
    RATE_OVER_205_CAP = "RATE_OVER_205_CAP"                # 利率逾16
    CAP_NOT_CONVERTIBLE = "CAP_NOT_CONVERTIBLE"            # 上限無法換算
    OVER_ONE_YEAR_AND_OVER_204 = "OVER_ONE_YEAR_AND_OVER_204"  # 滿一年且逾12%
    POSSIBLE_COMPOUNDING = "POSSIBLE_COMPOUNDING"          # 可能複利
    POSSIBLE_DISGUISED_INTEREST = "POSSIBLE_DISGUISED_INTEREST"  # 可能巧取利益
    EVIDENCE_GAP = "EVIDENCE_GAP"                          # 缺證據
    PENALTY_MAY_BE_REDUCED = "PENALTY_MAY_BE_REDUCED"      # 違約金可能被酌減
    TERM_DAYS_LONG = "TERM_DAYS_LONG"                      # 天數偏長
    NEEDS_LEGAL_REVIEW = "NEEDS_LEGAL_REVIEW"              # 需法律審查


class AuditAction(str, Enum):
    CREATE = "CREATE"                    # 建立
    POST = "POST"                        # 入帳
    REVERSE = "REVERSE"                  # 沖正
    ADJUST = "ADJUST"                    # 調整
    EXTEND = "EXTEND"                    # 展期
    SETTLE_QUOTE = "SETTLE_QUOTE"        # 結清試算
    SETTLE_POST = "SETTLE_POST"          # 結清入帳
    WRITEOFF = "WRITEOFF"                # 核銷
    RECOVERY = "RECOVERY"                # 收回
    VIEW_FULL_PII = "VIEW_FULL_PII"      # 看完整個資
    EXPORT = "EXPORT"                    # 匯出
    PERIOD_CLOSE = "PERIOD_CLOSE"        # 關帳
    PERIOD_REOPEN = "PERIOD_REOPEN"      # 重開
    SETTINGS_CHANGE = "SETTINGS_CHANGE"  # 改設定
    RECONCILE = "RECONCILE"              # 對帳
    SEGREGATION_WARNING = "SEGREGATION_WARNING"  # 單人操作警告
