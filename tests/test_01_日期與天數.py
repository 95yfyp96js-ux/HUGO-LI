"""D01／D02／D14：到期日、逾期天數、天數上下限。"""
from __future__ import annotations

import datetime as dt

import pytest

from slos.config import get_settings
from slos.dates import is_long_term, maturity_date, overdue_days, validate_term_days
from slos.errors import ErrorCode, SlosError


@pytest.mark.p0
@pytest.mark.parametrize("天數,到期日", [
    (7, dt.date(2026, 9, 18)),
    (10, dt.date(2026, 9, 21)),
    (15, dt.date(2026, 9, 26)),
    (21, dt.date(2026, 10, 2)),
    (30, dt.date(2026, 10, 11)),
])
def test_到期日等於撥款日加借款天數(天數, 到期日):
    assert maturity_date(dt.date(2026, 9, 11), 天數) == 到期日


@pytest.mark.p0
def test_到期當天逾期天數為零隔天起算():
    到期 = dt.date(2026, 10, 11)
    assert overdue_days(到期, dt.date(2026, 10, 10)) == 0
    assert overdue_days(到期, 到期) == 0
    assert overdue_days(到期, dt.date(2026, 10, 12)) == 1
    assert overdue_days(到期, dt.date(2026, 11, 10)) == 30


@pytest.mark.p0
def test_超過三百六十五天拒絕建立():
    with pytest.raises(SlosError) as error:
        validate_term_days(366)
    assert error.value.code is ErrorCode.E_TERM_DAYS_TOO_LONG


@pytest.mark.p0
def test_天數必須至少一天():
    with pytest.raises(SlosError) as error:
        validate_term_days(0)
    assert error.value.code is ErrorCode.E_INVALID_TERM_DAYS


def test_超過九十天打旗標但仍可建立():
    assert validate_term_days(120) == 120
    assert is_long_term(120)
    assert not is_long_term(30)


def test_畫面預設天數為七十十五三十():
    assert get_settings().term_days_presets == [7, 10, 15, 30]
