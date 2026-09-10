"""科目表（子）。代碼英數，名稱繁體中文。"""
from __future__ import annotations

from dataclasses import dataclass

from .errors import ErrorCode, SlosError

DEBIT = "DEBIT"
CREDIT = "CREDIT"


@dataclass(frozen=True)
class Account:
    code: str
    name_zh: str
    normal_side: str
    is_cash: bool = False


CHART: dict[str, Account] = {
    "1000": Account("1000", "現金", DEBIT, is_cash=True),
    "1010": Account("1010", "銀行", DEBIT, is_cash=True),
    "1100": Account("1100", "應收本金", DEBIT),
    "1110": Account("1110", "應收利息", DEBIT),
    "1120": Account("1120", "應收違約金", DEBIT),
    "1130": Account("1130", "應收費用", DEBIT),
    "2100": Account("2100", "暫收", CREDIT),
    "4100": Account("4100", "利息收入", CREDIT),
    "4110": Account("4110", "費用收入", CREDIT),
    "4120": Account("4120", "違約金收入", CREDIT),
    "9990": Account("9990", "調整", DEBIT),
}

CASH = "1000"
BANK = "1010"
AR_PRINCIPAL = "1100"
AR_INTEREST = "1110"
AR_PENALTY = "1120"
AR_FEE = "1130"
SUSPENSE = "2100"
INCOME_INTEREST = "4100"
INCOME_FEE = "4110"
INCOME_PENALTY = "4120"
ADJUSTMENT = "9990"

#: 沖帳分量 → 貸方科目（V1 利息收入採「收到才認列」）
BUCKET_CREDIT_ACCOUNT: dict[str, str] = {
    "FEE": INCOME_FEE,
    "INTEREST": INCOME_INTEREST,
    "PENALTY": INCOME_PENALTY,
    "PRINCIPAL": AR_PRINCIPAL,
    "SUSPENSE": SUSPENSE,
}

CASH_ACCOUNT_BY_METHOD: dict[str, str] = {"BANK": BANK, "CASH": CASH, "OTHER": CASH}


def get(code: str) -> Account:
    if code not in CHART:
        raise SlosError(ErrorCode.E_UNKNOWN_ACCOUNT, detail=code)
    return CHART[code]


def name_zh(code: str) -> str:
    return get(code).name_zh


def cash_account_for(method: str) -> str:
    if method not in CASH_ACCOUNT_BY_METHOD:
        raise SlosError(ErrorCode.E_UNKNOWN_ACCOUNT, detail=f"付款方式 {method}")
    return CASH_ACCOUNT_BY_METHOD[method]
