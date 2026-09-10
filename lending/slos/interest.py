"""計息引擎（庚）。

輸入：本金、利率值、利率單位、計息方法、日曆、期間定額、起日、迄日、進位、契約版本。

- 期間定額＋固定金額：滿期收該金額；部分還且非 sticky 則依剩餘本金與剩餘天數重算。
- 按日 365＋年利率：本金 × 年利率 × 天數 ÷ 365
- 按日 365＋日利率：本金 × 日利率 × 天數
- 按日 360：分母 360
- 滿期且起日＝撥款日、迄日＝到期日：天數用借款天數，避免閏年差一天
- 自訂公式 V1 拒絕
- 利息不得為負
- 禁止對利息再計息（BR-010）、禁止自動複利（BR-011）

本模組不得出現任何利率字面量；所有門檻取自設定檔（BR-019）。
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from decimal import Decimal

from .config import Settings, get_settings
from .enums import InterestMethod, RateType, RateUnit
from .errors import ErrorCode, SlosError
from .money import D, ZERO, interest_intermediate, money

DAYS_BASIS: dict[str, str] = {
    InterestMethod.ACT_365.value: "days_in_year_365",
    InterestMethod.ACT_360.value: "days_in_year_360",
}
BASIS_VALUE: dict[str, Decimal] = {
    InterestMethod.ACT_365.value: Decimal(365),
    InterestMethod.ACT_360.value: Decimal(360),
}


@dataclass(frozen=True)
class InterestTerms:
    """一份契約版本的計息條件快照。"""

    principal_original: Decimal
    term_days: int
    rate_value: Decimal
    rate_unit: str
    interest_method: str
    period_flat_amount: Decimal | None = None
    sticky_interest: bool = False
    rate_type: str = RateType.CONTRACT.value


@dataclass(frozen=True)
class Segment:
    """本金區段。半開區間 [start, end)，區段內本金不變。"""

    start: dt.date
    end: dt.date
    principal: Decimal

    @property
    def days(self) -> int:
        delta = (self.end - self.start).days
        return delta if delta > 0 else 0


@dataclass
class InterestResult:
    contract_amount: Decimal        # 契約原額利息（保存，不得默默砍）
    enforceable_amount: Decimal     # 可執行利息（逾上限的超額不認列）
    days_counted: int
    method_zh: str
    breakdown: list[str] = field(default_factory=list)
    capped: bool = False


def _require_positive_rate(value: Decimal) -> Decimal:
    if value < 0:
        raise SlosError(ErrorCode.E_NEGATIVE_AMOUNT, detail="利率值不得為負")
    return value


def _flat_base(terms: InterestTerms) -> Decimal:
    """期間定額的期間基準金額。"""
    if terms.rate_unit == RateUnit.FIXED_AMOUNT.value:
        if terms.period_flat_amount is None:
            raise SlosError(ErrorCode.E_MISSING_VALUE, detail="期間固定利息金額")
        return interest_intermediate(terms.period_flat_amount)
    if terms.rate_unit == RateUnit.PERIOD.value:
        return interest_intermediate(terms.principal_original * terms.rate_value)
    raise SlosError(
        ErrorCode.E_PENDING_DECISION,
        detail=f"待決策：計息方法「期間定額」搭配利率單位「{terms.rate_unit}」未於規格定義",
    )


def _segment_interest(terms: InterestTerms, segment: Segment, days: int) -> Decimal:
    method = terms.interest_method
    unit = terms.rate_unit
    rate = _require_positive_rate(D(terms.rate_value))

    if terms.rate_type == RateType.NONE.value or (
        rate == 0 and unit != RateUnit.FIXED_AMOUNT.value
    ):
        return ZERO

    if method == InterestMethod.CUSTOM.value:
        raise SlosError(ErrorCode.E_CUSTOM_FORMULA_UNSUPPORTED)

    if method == InterestMethod.PERIOD_FLAT.value:
        base = _flat_base(terms)
        if terms.sticky_interest:
            # 契約寫死固定利息：不隨本金減少、不隨提前清償縮減。
            return base if days > 0 else ZERO
        if terms.principal_original == 0 or terms.term_days == 0:
            return ZERO
        principal_ratio = D(segment.principal) / D(terms.principal_original)
        day_ratio = Decimal(days) / Decimal(terms.term_days)
        return interest_intermediate(base * principal_ratio * day_ratio)

    if method in BASIS_VALUE:
        basis = BASIS_VALUE[method]
        if unit == RateUnit.ANNUAL.value:
            return interest_intermediate(
                D(segment.principal) * rate * Decimal(days) / basis
            )
        if unit == RateUnit.DAILY.value:
            return interest_intermediate(D(segment.principal) * rate * Decimal(days))
        raise SlosError(
            ErrorCode.E_PENDING_DECISION,
            detail=f"待決策：計息方法「{method}」搭配利率單位「{unit}」未於規格定義",
        )

    raise SlosError(ErrorCode.E_PENDING_DECISION, detail=f"未知計息方法 {method}")


def compute(
    terms: InterestTerms,
    segments: list[Segment],
    *,
    effective_date: dt.date | None = None,
    maturity_date: dt.date | None = None,
    settings: Settings | None = None,
) -> InterestResult:
    """算出契約原額利息與可執行利息。中間值 8 位，最後入帳位四捨五入。"""
    from .compliance import annualized_rate_estimate  # 避免循環匯入

    cfg = settings or get_settings()
    if not segments:
        return InterestResult(ZERO, ZERO, 0, terms.interest_method, [], False)

    total_days = sum(seg.days for seg in segments)
    full_term = (
        effective_date is not None
        and maturity_date is not None
        and segments[0].start == effective_date
        and segments[-1].end == maturity_date
        and len(segments) == 1
    )

    contract_total = ZERO
    cap_total = ZERO
    breakdown: list[str] = []
    cap_rate = cfg.cap_annual_205
    days_in_year = Decimal(cfg.days_in_year)

    for segment in segments:
        # 滿期且起日＝撥款日、迄日＝到期日：天數用借款天數，避免閏年差一天。
        days = terms.term_days if full_term else segment.days
        amount = _segment_interest(terms, segment, days)
        contract_total += amount
        cap_total += interest_intermediate(
            D(segment.principal) * cap_rate * Decimal(days) / days_in_year
        )
        breakdown.append(
            f"{segment.start:%Y-%m-%d}～{segment.end:%Y-%m-%d}："
            f"本金 {money(segment.principal)}，{days} 天，利息 {money(amount)}"
        )

    if contract_total < 0:
        raise SlosError(ErrorCode.E_NEGATIVE_AMOUNT, detail="利息不得為負")

    contract_amount = money(contract_total)
    estimate = annualized_rate_estimate(terms, settings=cfg)
    capped = False
    enforceable = contract_amount
    if estimate is not None and estimate > cap_rate:
        # BR-020：超額不認列為可執行利息收入。契約原額仍完整保存。
        enforceable = money(min(contract_total, cap_total))
        capped = enforceable < contract_amount
    elif estimate is None:
        # 上限無法換算：不准默默砍，保留契約原額，另打旗標交法律審查。
        enforceable = contract_amount

    from .labels import INTEREST_METHOD

    return InterestResult(
        contract_amount=contract_amount,
        enforceable_amount=enforceable,
        days_counted=terms.term_days if full_term else total_days,
        method_zh=INTEREST_METHOD.get(terms.interest_method, terms.interest_method),
        breakdown=breakdown,
        capped=capped,
    )


def single_segment(
    terms: InterestTerms, start: dt.date, end: dt.date, principal: Decimal | None = None
) -> list[Segment]:
    return [Segment(start=start, end=end, principal=D(principal if principal is not None else terms.principal_original))]
