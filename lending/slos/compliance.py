"""合規旗標。旗標不是判決。

規格：合規旗標段　不得自動宣告整筆借貸無效，不得自動入罪。
規格：二　下列問題必須法律審查，程式不得當判決。
本模組不得出現任何利率字面量；門檻一律取自設定檔（BR-019）。
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .enums import ComplianceFlag, RateType, RateUnit
from .labels import COMPLIANCE_FLAG
from .models import ComplianceFlagRecord
from .money import D, rate as to_rate
from .sentinels import is_sentinel

#: 程式不得下判斷、必須送法律審查的事項（二）
LEGAL_REVIEW_TOPICS: tuple[str, ...] = (
    "日息／期息如何折成年利率以適用民法第 205 條",
    "某筆費用是否構成民法第 206 條巧取利益",
    "某經營型態是否需特許",
    "是否構成刑法第 344 條重利（需處境要件，不能只看利率）",
    "民法第 323 條「費用」是否包含契約違約金",
)

DISCLAIMER_ZH = (
    "本系統只產生作業旗標，不產生法律意見、不核貸、不認定契約效力。"
    "涉及法律效果的判斷，請交由律師處理。"
)


@dataclass(frozen=True)
class Flag:
    code: str
    label_zh: str
    detail_zh: str


def annualized_rate_estimate(terms, settings: Settings | None = None) -> Decimal | None:
    """把契約利率折成年利率的「推估值」，只用於打旗標。

    回傳 None 代表該利率單位無法換算年利率（BR-020：打「上限無法換算」＋法律審查）。
    """
    cfg = settings or get_settings()
    days_in_year = Decimal(cfg.days_in_year)
    unit = terms.rate_unit
    value = D(terms.rate_value)

    if terms.rate_type == RateType.NONE.value:
        return Decimal(0)
    if unit == RateUnit.ANNUAL.value:
        return to_rate(value)
    if unit == RateUnit.DAILY.value:
        return to_rate(value * days_in_year)
    if unit == RateUnit.PERIOD.value:
        if terms.term_days <= 0:
            return None
        return to_rate(value * days_in_year / Decimal(terms.term_days))
    if unit == RateUnit.FIXED_AMOUNT.value:
        if not cfg.estimate_annual_for_fixed_amount:
            return None
        principal = D(terms.principal_original)
        flat = terms.period_flat_amount
        if flat is None or principal == 0 or terms.term_days <= 0:
            return None
        return to_rate(D(flat) / principal * days_in_year / Decimal(terms.term_days))
    return None


def _flag(code: ComplianceFlag, detail: str) -> Flag:
    return Flag(code=code.value, label_zh=COMPLIANCE_FLAG[code], detail_zh=detail)


def evaluate(
    terms,
    *,
    elapsed_days: int = 0,
    fee_amount: Decimal | None = None,
    has_penalty_rule: bool = False,
    evidence_ref: str | None = None,
    capitalization_requested: bool = False,
    settings: Settings | None = None,
) -> list[Flag]:
    """產出旗標清單。全部是作業提示，不是法律結論。"""
    cfg = settings or get_settings()
    flags: list[Flag] = []
    estimate = annualized_rate_estimate(terms, settings=cfg)

    if estimate is None:
        flags.append(_flag(
            ComplianceFlag.CAP_NOT_CONVERTIBLE,
            f"利率單位「{terms.rate_unit}」無法換算年利率，契約原額照存，不自動調整。",
        ))
        flags.append(_flag(
            ComplianceFlag.NEEDS_LEGAL_REVIEW, LEGAL_REVIEW_TOPICS[0],
        ))
    else:
        if estimate > cfg.cap_annual_205:
            flags.append(_flag(
                ComplianceFlag.RATE_OVER_205_CAP,
                f"推估年利率 {estimate}，高於設定檔上限 {cfg.cap_annual_205}；"
                "超過部分不認列為可執行利息收入，契約原額仍完整保存。",
            ))
            flags.append(_flag(ComplianceFlag.NEEDS_LEGAL_REVIEW, LEGAL_REVIEW_TOPICS[0]))
        if elapsed_days >= cfg.elapsed_days_204 and estimate > cfg.threshold_annual_204:
            flags.append(_flag(
                ComplianceFlag.OVER_ONE_YEAR_AND_OVER_204,
                f"已滿 {elapsed_days} 天且推估年利率 {estimate} 高於 {cfg.threshold_annual_204}。",
            ))

    if capitalization_requested:
        flags.append(_flag(
            ComplianceFlag.POSSIBLE_COMPOUNDING,
            "要求把利息滾入本金。系統預設拒絕，需調整指令並經法律審查。",
        ))
        flags.append(_flag(ComplianceFlag.NEEDS_LEGAL_REVIEW, "民法第 207 條利息滾入原本之例外要件"))

    if fee_amount is not None and D(fee_amount) > 0:
        flags.append(_flag(
            ComplianceFlag.POSSIBLE_DISGUISED_INTEREST,
            f"契約載有費用 {D(fee_amount)}。是否構成巧取利益須法律審查。",
        ))
        flags.append(_flag(ComplianceFlag.NEEDS_LEGAL_REVIEW, LEGAL_REVIEW_TOPICS[1]))

    if has_penalty_rule:
        flags.append(_flag(
            ComplianceFlag.PENALTY_MAY_BE_REDUCED,
            "契約載有違約金。民法第 252 條，過高法院得酌減。",
        ))

    if evidence_ref is not None and (is_sentinel(evidence_ref) or not evidence_ref.strip()):
        flags.append(_flag(
            ComplianceFlag.EVIDENCE_GAP,
            "缺銀行流水等外部證據。事件仍成立，但必須列入未對帳清單（D06／BR-018）。",
        ))

    if terms.term_days > cfg.term_days_long_flag:
        flags.append(_flag(
            ComplianceFlag.TERM_DAYS_LONG,
            f"借款天數 {terms.term_days} 天超過 {cfg.term_days_long_flag} 天（作業政策，不是法律）。",
        ))

    unique: dict[tuple[str, str], Flag] = {}
    for item in flags:
        unique[(item.code, item.detail_zh)] = item
    return list(unique.values())


def persist(
    session: Session, flags: list[Flag], *, case_id: int | None, contract_version_id: int | None
) -> list[ComplianceFlagRecord]:
    records = [
        ComplianceFlagRecord(
            case_id=case_id,
            contract_version_id=contract_version_id,
            flag=item.code,
            detail=item.detail_zh,
        )
        for item in flags
    ]
    for record in records:
        session.add(record)
    session.flush()
    return records
