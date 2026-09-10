"""階段 0：金額型別、哨兵、錯誤。"""
from __future__ import annotations

from decimal import Decimal

import pytest

from slos.errors import ErrorCode, SlosError, MESSAGES_ZH_HANT
from slos.money import D, interest_intermediate, money, to_string
from slos.sentinels import (
    MISSING, NOT_APPLICABLE, SENTINELS, is_sentinel, require_evidence_ref,
    require_text_or_sentinel,
)


@pytest.mark.p0
def test_金額禁止浮點數():
    with pytest.raises(SlosError) as error:
        D(50000.5)
    assert error.value.code is ErrorCode.E_FLOAT_FORBIDDEN


@pytest.mark.p0
def test_入帳金額四捨五入到兩位():
    assert money("50000.005") == Decimal("50000.01")
    assert money("616.4383561") == Decimal("616.44")


@pytest.mark.p0
def test_利息中間值保留八位():
    assert interest_intermediate("616.43835616438") == Decimal("616.43835616")


@pytest.mark.p0
def test_金額對外一律字串():
    assert to_string(Decimal("50000")) == "50000.00"


@pytest.mark.p0
def test_未知資料只能用哨兵詞不得用零或空白():
    assert SENTINELS == {"MISSING", "UNKNOWN", "N/A", "PENDING", "NOT_VERIFIED"}
    assert is_sentinel(MISSING)
    assert not is_sentinel("0")
    with pytest.raises(SlosError) as error:
        require_text_or_sentinel("   ", "借據編號")
    assert error.value.code is ErrorCode.E_SENTINEL_REQUIRED


@pytest.mark.p0
def test_證據編號不得空字串():
    assert require_evidence_ref(MISSING) == MISSING
    with pytest.raises(SlosError) as error:
        require_evidence_ref("")
    assert error.value.code is ErrorCode.E_EVIDENCE_REF_EMPTY


@pytest.mark.p0
def test_錯誤說明一律繁體中文():
    for code in ErrorCode:
        assert code in MESSAGES_ZH_HANT, f"缺少繁中說明：{code}"
        assert MESSAGES_ZH_HANT[code].strip()
        assert not MESSAGES_ZH_HANT[code].isascii(), f"{code} 的說明必須是繁體中文"


def test_不適用哨兵詞可用於不適用欄位():
    assert is_sentinel(NOT_APPLICABLE)
