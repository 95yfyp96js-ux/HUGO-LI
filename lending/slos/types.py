"""SQLAlchemy 自訂型別：金額一律以文字保存，避免任何浮點數路徑。"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import String, TypeDecorator

from .money import D, money, rate as to_rate


class MoneyText(TypeDecorator):
    """入帳金額。資料庫存字串，如 "50000.00"。"""

    impl = String(32)
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Any) -> str | None:
        if value is None:
            return None
        return format(money(value), "f")

    def process_result_value(self, value: Any, dialect: Any) -> Decimal | None:
        if value is None:
            return None
        return D(value)


class RateText(TypeDecorator):
    """利率值。保留 8 位，字串保存。系統核心不寫死任何利率數字。"""

    impl = String(32)
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Any) -> str | None:
        if value is None:
            return None
        return format(to_rate(value), "f")

    def process_result_value(self, value: Any, dialect: Any) -> Decimal | None:
        if value is None:
            return None
        return D(value)
