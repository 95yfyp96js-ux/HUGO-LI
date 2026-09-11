"""壬／癸：收款、沖帳順序、溢繳、無法認列、部分還。"""
from __future__ import annotations

import datetime as dt
import json
from decimal import Decimal

import pytest

from slos import accounts, collection, ledger, positions, receivable
from slos.enums import AllocationBucket, CaseStatus, SuspenseReason
from slos.errors import ErrorCode, SlosError
from slos.models import Allocation, Receipt, SuspenseEntry
from tests.conftest import 建立案件, 撥款, 撥款日

到期日 = dt.date(2026, 10, 11)


@pytest.mark.p0
def test_預設沖帳順序為費用利息違約金本金(session, 管理員):
    case, _c, _f = 建立案件(
        session, 管理員, fee="300.00", penalty_rule="逾期一次 500 元", penalty_amount="500.00"
    )
    撥款(session, 管理員, case)
    session.commit()
    preview = collection.preview(session, case, Decimal("2000.00"), dt.date(2026, 10, 12))
    buckets = [line.bucket for line in preview.plan.lines]
    assert buckets[:4] == [
        AllocationBucket.FEE.value, AllocationBucket.INTEREST.value,
        AllocationBucket.PENALTY.value, AllocationBucket.PRINCIPAL.value,
    ]


@pytest.mark.p0
def test_無違約金規則則跳過違約金(session, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    preview = collection.preview(session, case, Decimal("1000.00"), 到期日)
    buckets = [line.bucket for line in preview.plan.lines]
    assert AllocationBucket.PENALTY.value not in buckets


@pytest.mark.p0
def test_付款人指定優先於預設順序(session, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    designation = json.dumps({"PRINCIPAL": "1000.00"})
    preview = collection.preview(
        session, case, Decimal("1000.00"), 到期日, payer_designation=designation
    )
    assert preview.plan.lines[0].bucket == AllocationBucket.PRINCIPAL.value
    assert preview.plan.lines[0].source_zh == "付款人指定"


@pytest.mark.p0
def test_部分還款後依剩餘本金與剩餘天數重算利息(session, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    collection.post(session, 管理員, case, amount=Decimal("20000.00"),
                    txn_date=dt.date(2026, 9, 21), idempotency_key="R1")
    session.commit()
    view = receivable.compute(session, case, 到期日)
    # 50000×15%×10/365 ＝ 205.48；剩餘 30205.48×15%×20/365 ＝ 248.26
    assert view.interest_contract == Decimal("453.74")
    assert view.principal_outstanding == Decimal("30205.48")
    assert case.status == CaseStatus.PARTIALLY_REPAID.value


@pytest.mark.p0
def test_溢繳進暫收不是收入也不是負本金(session, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    _receipt, _result, plan = collection.post(
        session, 管理員, case, amount=Decimal("99999.00"),
        txn_date=到期日, idempotency_key="R2",
    )
    session.commit()
    suspense = [l for l in plan.lines if l.bucket == AllocationBucket.SUSPENSE.value]
    assert suspense and suspense[0].amount > 0
    assert positions.principal_outstanding(session, case.id) == Decimal("0.00")
    assert positions.suspense_credit(session, case.id) == suspense[0].amount
    entry = session.query(SuspenseEntry).filter(SuspenseEntry.case_id == case.id).one()
    assert entry.reason == SuspenseReason.OVERPAYMENT.value


@pytest.mark.p0
def test_沒有案件編號只能掛暫收無法認列(session, 管理員):
    receipt, result, plan = collection.post(
        session, 管理員, None, amount=Decimal("5000.00"),
        txn_date=撥款日, idempotency_key="R3",
    )
    session.commit()
    assert plan is None
    assert receipt.case_id is None
    entry = session.query(SuspenseEntry).filter(SuspenseEntry.receipt_id == receipt.id).one()
    assert entry.reason == SuspenseReason.UNIDENTIFIED.value
    assert ledger.account_balance(session, accounts.SUSPENSE) == Decimal("5000.00")
    assert ledger.is_balanced(session)


@pytest.mark.p0
def test_本金不得沖成負數(session, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    _r, _res, plan = collection.post(
        session, 管理員, case, amount=Decimal("60000.00"),
        txn_date=到期日, idempotency_key="R4",
    )
    session.commit()
    principal = sum(
        (l.amount for l in plan.lines if l.bucket == AllocationBucket.PRINCIPAL.value),
        Decimal("0.00"),
    )
    assert principal == Decimal("50000.00")
    assert positions.principal_outstanding(session, case.id) == Decimal("0.00")


@pytest.mark.p0
def test_每筆沖帳列記錄當時規則編號(session, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    collection.post(session, 管理員, case, amount=Decimal("1000.00"),
                    txn_date=到期日, idempotency_key="R5")
    session.commit()
    rows = session.query(Allocation).filter(Allocation.case_id == case.id).all()
    assert rows and all(row.rule_code == "ALC-V1" for row in rows)


@pytest.mark.p0
def test_收款沖正後分戶與科目同步回復(session, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    receipt, _result, _plan = collection.post(
        session, 管理員, case, amount=Decimal("20000.00"),
        txn_date=dt.date(2026, 9, 21), idempotency_key="R6",
    )
    session.commit()
    assert positions.principal_outstanding(session, case.id) < Decimal("50000.00")
    collection.reverse_receipt(session, 管理員, receipt, reason="誤收", idempotency_key="REVR6")
    session.commit()
    assert positions.principal_outstanding(session, case.id) == Decimal("50000.00")
    assert positions.allocated_total(session, case.id, AllocationBucket.INTEREST) == Decimal("0.00")
    assert ledger.is_balanced(session)


def test_收款金額必須大於零(session, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    with pytest.raises(SlosError) as error:
        collection.post(session, 管理員, case, amount=Decimal("0.00"),
                        txn_date=到期日, idempotency_key="R7")
    assert error.value.code is ErrorCode.E_NEGATIVE_AMOUNT


def test_實收與沖帳分開建立(session, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    preview = collection.preview(session, case, Decimal("1000.00"), 到期日)
    assert session.query(Receipt).count() == 0  # 預覽不建立實收
    assert preview.plan.total == Decimal("1000.00")
