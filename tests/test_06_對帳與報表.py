"""丑／巳：對帳、帳齡、PAR30、儀表板、控制檢查。"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

import pytest

from slos import collection, reconciliation, reporting

from tests.conftest import 建立案件, 撥款, 撥款日

到期日 = dt.date(2026, 10, 11)


@pytest.mark.p0
def test_只靠金額不得自動標已配(session, 管理員):
    case, _c, _f = 建立案件(session, 管理員)
    撥款(session, 管理員, case, evidence="MISSING")
    session.commit()
    rows = [reconciliation.StatementRow(
        statement_ref="MISSING", amount=Decimal("50000.00"),
        value_date=撥款日, direction=reconciliation.DIRECTION_OUT,
    )]
    result = reconciliation.run(session, 管理員, rows)
    session.commit()
    assert result.matched == 0
    assert result.no_evidence == 1


@pytest.mark.p0
def test_流水金額方向日期都吻合才配對成功(session, 管理員):
    case, _c, _f = 建立案件(session, 管理員)
    撥款(session, 管理員, case, evidence="TXN-0001")
    session.commit()
    rows = [reconciliation.StatementRow(
        statement_ref="TXN-0001", amount=Decimal("50000.00"),
        value_date=撥款日 + dt.timedelta(days=1),
        direction=reconciliation.DIRECTION_OUT,
    )]
    result = reconciliation.run(session, 管理員, rows)
    session.commit()
    assert result.matched == 1
    assert reconciliation.unreconciled(session) == []


def test_日期超出正負兩天不配對(session, 管理員):
    case, _c, _f = 建立案件(session, 管理員)
    撥款(session, 管理員, case, evidence="TXN-0002")
    session.commit()
    rows = [reconciliation.StatementRow(
        statement_ref="TXN-0002", amount=Decimal("50000.00"),
        value_date=撥款日 + dt.timedelta(days=5),
        direction=reconciliation.DIRECTION_OUT,
    )]
    result = reconciliation.run(session, 管理員, rows)
    assert result.matched == 0 and result.unmatched == 1


def test_重複流水標記為重複(session, 管理員):
    case, _c, _f = 建立案件(session, 管理員)
    撥款(session, 管理員, case, evidence="TXN-0003")
    session.commit()
    row = reconciliation.StatementRow(
        statement_ref="TXN-0003", amount=Decimal("50000.00"),
        value_date=撥款日, direction=reconciliation.DIRECTION_OUT,
    )
    result = reconciliation.run(session, 管理員, [row, row])
    assert result.duplicates == 1


@pytest.mark.p0
def test_未對帳交易必須出現在儀表板(session, 管理員, 已撥款案件):
    board = reporting.dashboard(session, 撥款日)
    assert board.unreconciled_count == 1
    assert any("未對帳" in item for item in board.exceptions_zh)


@pytest.mark.p0
def test_帳齡分量分開列且PAR30只算逾期三十天以上未償本金(session, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    rows, par = reporting.aging(session, 到期日)
    assert [row.bucket_zh for row in rows] == ["未逾期", "1–7", "8–15", "16–30", "31–60", "61 以上"]
    assert par == Decimal("0.00")

    rows2, par2 = reporting.aging(session, 到期日 + dt.timedelta(days=35))
    assert par2 == Decimal("50000.00")
    逾期列 = [row for row in rows2 if row.bucket_zh == "31–60"][0]
    assert 逾期列.principal == Decimal("50000.00")
    assert 逾期列.interest > 0


@pytest.mark.p0
def test_控制檢查全部通過(session, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    collection.post(session, 管理員, case, amount=Decimal("20000.00"),
                    txn_date=dt.date(2026, 9, 21), idempotency_key="C1")
    session.commit()
    checks = reporting.control_checks(session, 到期日)
    names = {check.name_zh for check in checks}
    assert {"借貸平衡", "分戶本金等於 1100", "現金可重建", "無孤兒分錄",
            "無重複入帳", "應收快照可重放"} <= names
    assert all(check.passed for check in checks), [c.detail_zh for c in checks if not c.passed]


@pytest.mark.p0
def test_應收快照可重算核對(session, 管理員, 已撥款案件):
    from slos import receivable
    from slos.models import ReceivableSnapshot

    case, _contract = 已撥款案件
    record = receivable.snapshot(session, case, 到期日, receivable.TRIGGER_MATURITY)
    session.commit()
    ok, message = receivable.replay_matches(session, case, record)
    assert ok, message
    assert session.query(ReceivableSnapshot).count() >= 2


def test_儀表板第一眼不是只看賺多少(session, 管理員, 已撥款案件):
    board = reporting.dashboard(session, 到期日)
    for field in ("due_today_count", "receivable_today", "received_today",
                  "disbursed_today", "overdue_count", "suspense_amount",
                  "unreconciled_count", "pending_allocation_count"):
        assert hasattr(board, field)


def test_案件頁三秒內看得到關鍵欄位(session, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    page = reporting.case_page(session, case, 到期日)
    for key in ("借款人", "本金（契約面額）", "撥款日", "借款天數", "到期日", "利率值",
                "計息方法", "目前本金", "未收利息", "逾期天數", "今日應收合計", "案件狀態"):
        assert key in page


@pytest.mark.p0
def test_同一天多筆交易的快照仍可逐筆重放(session, 管理員, 已撥款案件):
    """辛：必須能重算核對上一張快照。同日先後順序靠傳票序號切點還原。"""
    from slos import receivable, settlement

    case, _contract = 已撥款案件
    報價 = settlement.quote(session, 管理員, case, 到期日)
    session.commit()
    settlement.post(
        session, 管理員, case, 報價.quote, amount=Decimal("50616.44"),
        txn_date=到期日, idempotency_key="SAMEDAY",
    )
    session.commit()

    from slos.models import ReceivableSnapshot

    快照們 = session.query(ReceivableSnapshot).all()
    assert len(快照們) >= 3
    for record in 快照們:
        ok, message = receivable.replay_matches(session, case, record)
        assert ok, message
    當日快照 = [r for r in 快照們 if r.as_of_date == 到期日]
    assert {r.total_due for r in 當日快照} == {Decimal("50616.44"), Decimal("0.00")}
