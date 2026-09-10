"""測試共用夾具。說明與測試名稱一律繁體中文。"""
from __future__ import annotations

import datetime as dt
import sys
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from slos import cases as case_service  # noqa: E402
from slos import disbursement  # noqa: E402
from slos.db import make_engine, make_session_factory  # noqa: E402
from slos.enums import InterestMethod, RateUnit, Role  # noqa: E402
from slos.models import create_all  # noqa: E402
from slos.rbac import Actor  # noqa: E402
from slos.sentinels import MISSING  # noqa: E402

撥款日 = dt.date(2026, 9, 11)


@pytest.fixture()
def session():
    engine = make_engine("sqlite+pysqlite:///:memory:")
    create_all(engine)
    factory = make_session_factory(engine)
    with factory() as active:
        yield active


@pytest.fixture()
def 管理員() -> Actor:
    return Actor("系統管理員", Role.ADMIN.value)


@pytest.fixture()
def 作業員() -> Actor:
    return Actor("作業員甲", Role.OPERATOR.value)


@pytest.fixture()
def 帳務() -> Actor:
    return Actor("帳務乙", Role.ACCOUNTING.value)


@pytest.fixture()
def 唯讀() -> Actor:
    return Actor("唯讀丙", Role.READONLY.value)


def 建立案件(
    session,
    actor,
    *,
    principal="50000.00",
    days=30,
    rate="0.15",
    rate_unit=RateUnit.ANNUAL.value,
    method=InterestMethod.ACT_365.value,
    flat_amount=None,
    sticky=False,
    fee="0",
    penalty_rule="N/A",
    penalty_amount="0",
    disburse_date=撥款日,
    national_id="A123456789",
    contract_ref=MISSING,
):
    data = case_service.IntakeInput(
        customer_name="借款人甲",
        principal=Decimal(principal),
        term_days=days,
        rate_value=Decimal(rate),
        rate_unit=rate_unit,
        interest_method=method,
        disburse_date=disburse_date,
        period_flat_amount=Decimal(flat_amount) if flat_amount is not None else None,
        sticky_interest=sticky,
        fee_amount=Decimal(fee),
        penalty_rule=penalty_rule,
        penalty_amount=Decimal(penalty_amount),
        national_id=national_id,
        contract_ref=contract_ref,
    )
    return case_service.intake(session, actor, data)


def 撥款(session, actor, case, amount="50000.00", date=撥款日, key=None, evidence=MISSING):
    return disbursement.post(
        session, actor, case,
        amount=Decimal(amount), txn_date=date,
        idempotency_key=key or f"DISB-{case.case_no}",
        evidence_ref=evidence,
    )


@pytest.fixture()
def 已撥款案件(session, 管理員):
    case, contract, _flags = 建立案件(session, 管理員)
    撥款(session, 管理員, case)
    session.commit()
    return case, contract
