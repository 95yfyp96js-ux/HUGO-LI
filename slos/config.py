"""設定檔載入。

規格：BR-019　利率用類型欄位保存，系統核心不得寫死任何利率數字。
本模組只負責讀取 config/settings.default.json（或 SLOS_SETTINGS 指定的檔案），
引擎一律向這裡取值，程式碼內不得出現利率字面量。
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Any

from .errors import SlosError, ErrorCode

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "config" / "settings.default.json"


@dataclass(frozen=True)
class Settings:
    raw: dict[str, Any]
    source: str

    # --- 基本 ---
    @property
    def currency(self) -> str:
        return self.raw["currency"]

    @property
    def timezone(self) -> str:
        return self.raw["timezone"]

    @property
    def amount_tolerance(self) -> Decimal:
        return Decimal(self.raw["amount_tolerance"])

    # --- 到期日 ---
    @property
    def maturity_date_mode(self) -> str:
        return self.raw["maturity_date_mode"]

    # --- 天數 ---
    @property
    def term_days_min(self) -> int:
        return int(self.raw["term_days_min"])

    @property
    def term_days_max(self) -> int:
        return int(self.raw["term_days_max"])

    @property
    def term_days_presets(self) -> list[int]:
        return [int(d) for d in self.raw["term_days_presets"]]

    @property
    def term_days_long_flag(self) -> int:
        return int(self.raw["term_days_long_flag"])

    # --- 法規門檻（參數，不是判決） ---
    @property
    def cap_annual_205(self) -> Decimal:
        return Decimal(self.raw["statutory"]["civil_code_205_annual_cap"])

    @property
    def threshold_annual_204(self) -> Decimal:
        return Decimal(self.raw["statutory"]["civil_code_204_annual_threshold"])

    @property
    def statutory_annual_203(self) -> Decimal:
        return Decimal(self.raw["statutory"]["civil_code_203_statutory_annual_rate"])

    @property
    def elapsed_days_204(self) -> int:
        return int(self.raw["statutory"]["civil_code_204_elapsed_days"])

    # --- 折年 ---
    @property
    def days_in_year(self) -> int:
        return int(self.raw["annualization"]["days_in_year"])

    @property
    def estimate_annual_for_fixed_amount(self) -> bool:
        return bool(self.raw["annualization"]["estimate_for_fixed_amount"])

    # --- 沖帳 ---
    @property
    def allocation_order(self) -> list[str]:
        return list(self.raw["allocation"]["default_order"])

    @property
    def allocation_rule_code(self) -> str:
        return self.raw["allocation"]["rule_code"]

    # --- 其他營運參數 ---
    @property
    def interest_income_recognition(self) -> str:
        return self.raw["interest_income_recognition"]

    @property
    def suspense_alert_days(self) -> int:
        return int(self.raw["suspense_alert_days"])

    @property
    def aging_buckets(self) -> list[tuple[int, int | None]]:
        return [(int(lo), None if hi is None else int(hi)) for lo, hi in self.raw["aging_buckets"]]

    @property
    def par_overdue_days(self) -> int:
        return int(self.raw["par_overdue_days"])

    @property
    def recon_date_window_days(self) -> int:
        return int(self.raw["reconciliation"]["date_window_days"])

    @property
    def allow_amount_only_auto_match(self) -> bool:
        return bool(self.raw["reconciliation"]["allow_amount_only_auto_match"])

    @property
    def settlement_quote_valid_days(self) -> int:
        return int(self.raw["settlement_quote_valid_days"])

    @property
    def adjustment_single_limit(self) -> Decimal:
        return Decimal(self.raw["adjustment_single_limit"])

    @property
    def backup_copies(self) -> int:
        return int(self.raw["backup_copies"])

    @property
    def demo(self) -> dict[str, Any]:
        return dict(self.raw["demo"])


def load_settings(path: str | os.PathLike[str] | None = None) -> Settings:
    target = Path(path) if path else Path(os.environ.get("SLOS_SETTINGS", DEFAULT_PATH))
    if not target.exists():
        raise SlosError(ErrorCode.E_PENDING_DECISION, detail=f"找不到設定檔：{target}")
    data = json.loads(target.read_text(encoding="utf-8"))
    return Settings(raw=data, source=str(target))


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return load_settings()


def reset_settings_cache() -> None:
    get_settings.cache_clear()
