"""金額與利率的唯一型別來源。

規格：〇-7　金額一律 Decimal。幣別 TWD。入帳小數 2 位。
利息中間值 8 位。入帳時四捨五入到 2 位。
禁止 JavaScript number，Python 端等同禁止 float。
"""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Union

from .errors import SlosError, ErrorCode

# 入帳位數（元）
BOOKING_EXPONENT = Decimal("0.01")
# 利息中間值位數
INTEREST_EXPONENT = Decimal("0.00000001")
# 利率保存位數
RATE_EXPONENT = Decimal("0.00000001")

ZERO = Decimal("0.00")

Numeric = Union[Decimal, int, str]


def D(value: Numeric) -> Decimal:
    """把輸入轉成 Decimal。float 一律拒絕，不做靜默轉換。"""
    if isinstance(value, float):
        raise SlosError(
            ErrorCode.E_FLOAT_FORBIDDEN,
            detail=f"收到浮點數 {value!r}",
        )
    if isinstance(value, Decimal):
        return value
    if isinstance(value, bool):
        raise SlosError(ErrorCode.E_FLOAT_FORBIDDEN, detail="布林值不是金額")
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, str):
        text = value.strip()
        if text == "":
            raise SlosError(ErrorCode.E_MISSING_VALUE, detail="金額字串為空白")
        try:
            return Decimal(text)
        except Exception as exc:  # noqa: BLE001
            raise SlosError(ErrorCode.E_AMOUNT_INVALID, detail=f"無法解析金額：{value!r}") from exc
    raise SlosError(ErrorCode.E_AMOUNT_INVALID, detail=f"不支援的金額型別：{type(value).__name__}")


def money(value: Numeric) -> Decimal:
    """入帳金額：四捨五入到 2 位。"""
    return D(value).quantize(BOOKING_EXPONENT, rounding=ROUND_HALF_UP)


def interest_intermediate(value: Numeric) -> Decimal:
    """利息中間值：保留 8 位，尚未入帳。"""
    return D(value).quantize(INTEREST_EXPONENT, rounding=ROUND_HALF_UP)


def rate(value: Numeric) -> Decimal:
    """利率值：保留 8 位。系統核心不得寫死任何利率數字，此處只做型別處理。"""
    return D(value).quantize(RATE_EXPONENT, rounding=ROUND_HALF_UP)


def require_non_negative(value: Decimal, field: str) -> Decimal:
    if value < 0:
        raise SlosError(ErrorCode.E_NEGATIVE_AMOUNT, detail=f"{field} 不得為負：{value}")
    return value


def to_string(value: Decimal) -> str:
    """API／Excel 對外一律字串，例如 "50000.00"。"""
    return format(money(value), "f")


def is_zero_within(value: Decimal, tolerance: Decimal) -> bool:
    """尾差判斷。tolerance 由設定檔提供，不寫死於引擎。"""
    return abs(D(value)) < D(tolerance)
