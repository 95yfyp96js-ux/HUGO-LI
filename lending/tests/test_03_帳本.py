"""階段 2：只能追加的帳本、借貸平衡、冪等、不可變、關帳。"""
from __future__ import annotations

from decimal import Decimal

import pytest

from slos import accounts, ledger, periods, positions
from slos.enums import TxnType
from slos.errors import ErrorCode, SlosError
from slos.models import AuditLog, JournalEntry
from tests.conftest import 建立案件, 撥款, 撥款日


def _平衡分錄():
    return [
        ledger.Line(accounts.AR_PRINCIPAL, debit=Decimal("100.00")),
        ledger.Line(accounts.BANK, credit=Decimal("100.00")),
    ]


@pytest.mark.p0
def test_借貸不平衡不得入帳(session, 管理員):
    with pytest.raises(SlosError) as error:
        ledger.post(
            session, 管理員, txn_type=TxnType.ADJUSTMENT, txn_date=撥款日,
            value_date=撥款日, idempotency_key="X1",
            lines=[
                ledger.Line(accounts.AR_PRINCIPAL, debit=Decimal("100.00")),
                ledger.Line(accounts.BANK, credit=Decimal("90.00")),
            ],
        )
    assert error.value.code is ErrorCode.E_UNBALANCED_ENTRY


@pytest.mark.p0
def test_會動錢的操作必須帶冪等鍵(session, 管理員):
    with pytest.raises(SlosError) as error:
        ledger.post(
            session, 管理員, txn_type=TxnType.ADJUSTMENT, txn_date=撥款日,
            value_date=撥款日, idempotency_key="  ", lines=_平衡分錄(),
        )
    assert error.value.code is ErrorCode.E_IDEMPOTENCY_KEY_REQUIRED


@pytest.mark.p0
def test_同一冪等鍵不重複入帳(session, 管理員):
    first = ledger.post(session, 管理員, txn_type=TxnType.ADJUSTMENT, txn_date=撥款日,
                        value_date=撥款日, idempotency_key="K1", lines=_平衡分錄())
    second = ledger.post(session, 管理員, txn_type=TxnType.ADJUSTMENT, txn_date=撥款日,
                         value_date=撥款日, idempotency_key="K1", lines=_平衡分錄())
    assert second.duplicate is True
    assert second.entry.id == first.entry.id
    assert session.query(JournalEntry).count() == 1


@pytest.mark.p0
def test_已入帳交易不得修改(session, 管理員, 已撥款案件):
    from slos.models import Disbursement

    case, _contract = 已撥款案件
    posted = session.query(Disbursement).filter(
        Disbursement.case_id == case.id
    ).one()
    posted.amount = Decimal("1.00")
    with pytest.raises(SlosError) as error:
        session.flush()
    assert error.value.code is ErrorCode.E_IMMUTABLE_POSTED
    session.rollback()


@pytest.mark.p0
def test_已入帳交易不得刪除(session, 管理員, 已撥款案件):
    from slos.models import Disbursement

    case, _contract = 已撥款案件
    posted = session.query(Disbursement).filter(Disbursement.case_id == case.id).one()
    session.delete(posted)
    with pytest.raises(SlosError) as error:
        session.flush()
    assert error.value.code is ErrorCode.E_DELETE_FORBIDDEN
    session.rollback()


@pytest.mark.p0
def test_稽核紀錄不得修改也不得刪除(session, 管理員, 已撥款案件):
    log = session.query(AuditLog).first()
    assert log is not None
    log.detail = "竄改"
    with pytest.raises(SlosError) as error:
        session.flush()
    assert error.value.code is ErrorCode.E_AUDIT_IMMUTABLE
    session.rollback()

    log = session.query(AuditLog).first()
    assert log is not None
    session.delete(log)
    with pytest.raises(SlosError) as error:
        session.flush()
    assert error.value.code is ErrorCode.E_AUDIT_IMMUTABLE
    session.rollback()


@pytest.mark.p0
def test_關帳後不得入帳且重開必須寫原因(session, 管理員, 帳務):
    case, _contract, _flags = 建立案件(session, 管理員)
    periods.close(session, 撥款日, 帳務)
    with pytest.raises(SlosError) as error:
        撥款(session, 管理員, case)
    assert error.value.code is ErrorCode.E_PERIOD_CLOSED

    with pytest.raises(SlosError) as reopen_error:
        periods.reopen(session, 撥款日, 管理員, "")
    assert reopen_error.value.code is ErrorCode.E_PERIOD_REOPEN_REASON_REQUIRED

    periods.reopen(session, 撥款日, 管理員, "補登九月漏帳")
    撥款(session, 管理員, case)
    assert positions.principal_outstanding(session, case.id) == Decimal("50000.00")


@pytest.mark.p0
def test_沖正產生反向分錄且不就地覆寫原列(session, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    original = session.query(JournalEntry).filter(
        JournalEntry.txn_type == TxnType.DISBURSEMENT.value
    ).one()
    result = ledger.reverse(session, 管理員, original, idempotency_key="REV-1", reason="重複撥款")
    assert result.entry.reverses_entry_id == original.id
    assert ledger.is_reversed(session, original) is True
    assert positions.principal_outstanding(session, case.id) == Decimal("0.00")
    assert ledger.is_balanced(session)

    with pytest.raises(SlosError) as error:
        ledger.reverse(session, 管理員, original, idempotency_key="REV-2", reason="再沖一次")
    assert error.value.code is ErrorCode.E_ALREADY_REVERSED


def test_未知科目不得入帳(session, 管理員):
    with pytest.raises(SlosError) as error:
        ledger.post(
            session, 管理員, txn_type=TxnType.ADJUSTMENT, txn_date=撥款日,
            value_date=撥款日, idempotency_key="K9",
            lines=[
                ledger.Line("8888", debit=Decimal("1.00")),
                ledger.Line(accounts.BANK, credit=Decimal("1.00")),
            ],
        )
    assert error.value.code is ErrorCode.E_UNKNOWN_ACCOUNT


def test_撥款產生借應收本金貸資金的分錄(session, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    assert ledger.account_balance(session, accounts.AR_PRINCIPAL, case_id=case.id) == Decimal("50000.00")
    assert ledger.account_balance(session, accounts.BANK) == Decimal("-50000.00")
    assert ledger.is_balanced(session)
