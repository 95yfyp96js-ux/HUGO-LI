"""庚：計息引擎。期間定額、按日365、按日360、上限與旗標。"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

import pytest

from slos.compliance import annualized_rate_estimate, evaluate
from slos.enums import ComplianceFlag, InterestMethod, RateUnit
from slos.errors import ErrorCode, SlosError
from slos.interest import InterestTerms, Segment, compute, single_segment

起日 = dt.date(2026, 9, 11)
迄日 = dt.date(2026, 10, 11)


def 條件(**kwargs) -> InterestTerms:
    base = dict(
        principal_original=Decimal("50000.00"), term_days=30,
        rate_value=Decimal("0.15"), rate_unit=RateUnit.ANNUAL.value,
        interest_method=InterestMethod.ACT_365.value,
    )
    base.update(kwargs)
    return InterestTerms(**base)


@pytest.mark.p0
def test_按日365年利率():
    terms = 條件()
    result = compute(terms, single_segment(terms, 起日, 迄日),
                     effective_date=起日, maturity_date=迄日)
    assert result.contract_amount == Decimal("616.44")
    assert result.method_zh == "按日365"


@pytest.mark.p0
def test_按日365日利率():
    terms = 條件(rate_value=Decimal("0.0005"), rate_unit=RateUnit.DAILY.value)
    result = compute(terms, single_segment(terms, 起日, 迄日),
                     effective_date=起日, maturity_date=迄日)
    assert result.contract_amount == Decimal("750.00")


def test_按日360分母為三百六十():
    terms = 條件(interest_method=InterestMethod.ACT_360.value)
    result = compute(terms, single_segment(terms, 起日, 迄日),
                     effective_date=起日, maturity_date=迄日)
    assert result.contract_amount == Decimal("625.00")


@pytest.mark.p0
def test_期間定額滿期收該金額():
    terms = 條件(
        rate_value=Decimal("0"), rate_unit=RateUnit.FIXED_AMOUNT.value,
        interest_method=InterestMethod.PERIOD_FLAT.value,
        period_flat_amount=Decimal("600.00"),
    )
    result = compute(terms, single_segment(terms, 起日, 迄日),
                     effective_date=起日, maturity_date=迄日)
    assert result.contract_amount == Decimal("600.00")
    assert result.method_zh == "期間定額"


@pytest.mark.p0
def test_期間定額非sticky依剩餘本金與天數重算():
    terms = 條件(
        rate_value=Decimal("0"), rate_unit=RateUnit.FIXED_AMOUNT.value,
        interest_method=InterestMethod.PERIOD_FLAT.value,
        period_flat_amount=Decimal("600.00"),
    )
    segments = [
        Segment(起日, dt.date(2026, 9, 21), Decimal("50000.00")),
        Segment(dt.date(2026, 9, 21), 迄日, Decimal("25000.00")),
    ]
    result = compute(terms, segments, effective_date=起日, maturity_date=迄日)
    # 600 × 10/30 ＋ 600 × (25000/50000) × 20/30
    assert result.contract_amount == Decimal("400.00")


@pytest.mark.p0
def test_期間定額勾選sticky則不隨本金減少():
    terms = 條件(
        rate_value=Decimal("0"), rate_unit=RateUnit.FIXED_AMOUNT.value,
        interest_method=InterestMethod.PERIOD_FLAT.value,
        period_flat_amount=Decimal("600.00"), sticky_interest=True,
    )
    segments = [Segment(起日, dt.date(2026, 9, 21), Decimal("50000.00"))]
    result = compute(terms, segments, effective_date=起日, maturity_date=迄日)
    assert result.contract_amount == Decimal("600.00")


def test_自訂公式在V1被拒絕():
    terms = 條件(interest_method=InterestMethod.CUSTOM.value)
    with pytest.raises(SlosError) as error:
        compute(terms, single_segment(terms, 起日, 迄日))
    assert error.value.code is ErrorCode.E_CUSTOM_FORMULA_UNSUPPORTED


def test_未定義的利率單位與計息方法組合停止並標待決策():
    terms = 條件(rate_unit=RateUnit.FIXED_AMOUNT.value)
    with pytest.raises(SlosError) as error:
        compute(terms, single_segment(terms, 起日, 迄日))
    assert error.value.code is ErrorCode.E_PENDING_DECISION


def test_利率不得為負():
    terms = 條件(rate_value=Decimal("-0.01"))
    with pytest.raises(SlosError) as error:
        compute(terms, single_segment(terms, 起日, 迄日))
    assert error.value.code is ErrorCode.E_NEGATIVE_AMOUNT


@pytest.mark.p0
def test_年利率逾上限超額不認列但契約原額保存():
    terms = 條件(rate_value=Decimal("0.36"))
    result = compute(terms, single_segment(terms, 起日, 迄日),
                     effective_date=起日, maturity_date=迄日)
    assert result.contract_amount == Decimal("1479.45")
    assert result.enforceable_amount == Decimal("657.53")
    assert result.capped is True
    flags = {flag.code for flag in evaluate(terms)}
    assert ComplianceFlag.RATE_OVER_205_CAP.value in flags
    assert ComplianceFlag.NEEDS_LEGAL_REVIEW.value in flags


def test_日息與期息折年只是推估():
    日息 = 條件(rate_value=Decimal("0.001"), rate_unit=RateUnit.DAILY.value)
    assert annualized_rate_estimate(日息) == Decimal("0.36500000")
    期息 = 條件(rate_value=Decimal("0.03"), rate_unit=RateUnit.PERIOD.value)
    assert annualized_rate_estimate(期息) == Decimal("0.36500000")


def test_滿期時用借款天數避免閏年差一天():
    terms = 條件(term_days=365, principal_original=Decimal("36500.00"))
    起 = dt.date(2028, 1, 1)  # 2028 為閏年
    迄 = 起 + dt.timedelta(days=365)
    result = compute(terms, single_segment(terms, 起, 迄),
                     effective_date=起, maturity_date=迄)
    assert result.days_counted == 365
