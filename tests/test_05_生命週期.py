"""己／丑／寅：進件、展期、結清、核銷、調整、狀態機。"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

import pytest

from slos import adjustments, cases as case_service, extension, ledger, positions, settlement
from slos.enums import CaseStatus, ContractSource
from slos.errors import ErrorCode, SlosError
from slos.models import ComplianceFlagRecord, ContractVersion
from tests.conftest import 建立案件, 撥款

到期日 = dt.date(2026, 10, 11)


@pytest.mark.p0
def test_建立案件不是核貸且沒有核准狀態(session, 管理員):
    case, contract, _flags = 建立案件(session, 管理員)
    assert case.status == CaseStatus.DRAFT.value
    assert not hasattr(case, "approval_status")
    assert {status.value for status in CaseStatus}.isdisjoint({"APPROVED", "PENDING_DISBURSE"})
    with pytest.raises(SlosError) as error:
        case_service.reject_forbidden_input({"approval_status": "APPROVED"})
    assert error.value.code is ErrorCode.E_NOT_AN_APPROVAL_SYSTEM


@pytest.mark.p0
def test_禁止投資人與募資欄位(session):
    with pytest.raises(SlosError) as error:
        case_service.reject_forbidden_input({"investor_id": 1})
    assert error.value.code is ErrorCode.E_FORBIDDEN_FEATURE


@pytest.mark.p0
def test_示範案為三十天且到期日正確(session, 管理員):
    case, contract, _flags = 建立案件(session, 管理員, rate="0")
    assert case.case_no == "L20260911-001"
    assert contract.term_days == 30
    assert contract.maturity_date == dt.date(2026, 10, 11)
    assert contract.face_amount == Decimal("50000.00")


@pytest.mark.p0
def test_缺流水仍可入帳但對帳狀態為待對(session, 管理員):
    from slos.enums import ReconStatus

    case, _c, _f = 建立案件(session, 管理員)
    record, _result = 撥款(session, 管理員, case)
    session.commit()
    assert record.evidence_ref == "MISSING"
    assert record.recon_status == ReconStatus.PENDING.value
    assert positions.principal_outstanding(session, case.id) == Decimal("50000.00")


@pytest.mark.p0
def test_展期建立新版本且不覆寫舊契約(session, 管理員, 已撥款案件):
    case, contract = 已撥款案件
    舊到期日 = contract.maturity_date
    _record, version = extension.extend(session, 管理員, case, new_term_days=30)
    session.commit()
    versions = session.query(ContractVersion).filter(ContractVersion.case_id == case.id).all()
    assert len(versions) == 2
    舊版 = [v for v in versions if v.version_no == 1][0]
    assert 舊版.maturity_date == 舊到期日
    assert 舊版.is_current is False
    assert version.source == ContractSource.EXTENSION.value
    assert version.maturity_date == 舊到期日 + dt.timedelta(days=30)
    assert case.case_no == versions[0].case.case_no if hasattr(versions[0], "case") else True
    assert case.status == CaseStatus.EXTENDED.value


@pytest.mark.p0
def test_展期不得自動把利息滾入本金(session, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    with pytest.raises(SlosError) as error:
        extension.extend(session, 管理員, case, new_term_days=30, capitalize_interest=True)
    assert error.value.code is ErrorCode.E_CAPITALIZATION_FORBIDDEN


@pytest.mark.p0
def test_展期後本金不含利息(session, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    _record, version = extension.extend(session, 管理員, case, new_term_days=30)
    session.commit()
    assert version.face_amount == Decimal("50000.00")
    assert positions.principal_outstanding(session, case.id) == Decimal("50000.00")


@pytest.mark.p0
def test_利息轉本金預設拒絕須管理員加法律審查標記(session, 管理員, 作業員, 已撥款案件):
    case, _contract = 已撥款案件
    with pytest.raises(SlosError) as error:
        adjustments.capitalize_interest(
            session, 管理員, case, amount=Decimal("100.00"), reason="現場要求",
            txn_date=到期日, idempotency_key="CAP1",
        )
    assert error.value.code is ErrorCode.E_CAPITALIZATION_FORBIDDEN

    with pytest.raises(SlosError) as denied:
        adjustments.capitalize_interest(
            session, 作業員, case, amount=Decimal("100.00"), reason="現場要求",
            txn_date=到期日, idempotency_key="CAP2", legal_review_acknowledged=True,
        )
    assert denied.value.code is ErrorCode.E_PERMISSION_DENIED

    調整 = adjustments.capitalize_interest(
        session, 管理員, case, amount=Decimal("100.00"), reason="經律師確認",
        txn_date=到期日, idempotency_key="CAP3", legal_review_acknowledged=True,
    )
    session.commit()
    assert 調整.legal_review_required is True
    flags = {row.flag for row in session.query(ComplianceFlagRecord).all()}
    assert "POSSIBLE_COMPOUNDING" in flags and "NEEDS_LEGAL_REVIEW" in flags


@pytest.mark.p0
def test_結清試算不是已結清(session, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    result = settlement.quote(session, 管理員, case, 到期日)
    session.commit()
    assert case.status != CaseStatus.SETTLED.value
    assert result.quote.total == Decimal("50616.44")


@pytest.mark.p0
def test_結清入帳後尾差小於容差才轉已結清(session, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    result = settlement.quote(session, 管理員, case, 到期日)
    record, _receipt = settlement.post(
        session, 管理員, case, result.quote, amount=Decimal("50616.44"),
        txn_date=到期日, idempotency_key="SET1",
    )
    session.commit()
    assert record.residual == Decimal("0.00")
    assert case.status == CaseStatus.SETTLED.value


def test_結清報價過期必須重新試算(session, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    result = settlement.quote(session, 管理員, case, 到期日)
    with pytest.raises(SlosError) as error:
        settlement.post(
            session, 管理員, case, result.quote, amount=Decimal("50616.44"),
            txn_date=到期日 + dt.timedelta(days=10), idempotency_key="SET2",
        )
    assert error.value.code is ErrorCode.E_QUOTE_EXPIRED


@pytest.mark.p0
def test_核銷不刪案件之後收款走收回(session, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    核銷 = adjustments.write_off(
        session, 管理員, case, reason="失聯", txn_date=到期日, idempotency_key="WO1"
    )
    session.commit()
    assert 核銷.amount == Decimal("50000.00")
    assert case.status == CaseStatus.WRITTEN_OFF.value
    assert session.get(type(case), case.id) is not None
    assert positions.principal_outstanding(session, case.id) == Decimal("0.00")

    receipt = adjustments.recovery(
        session, 管理員, case, amount=Decimal("10000.00"),
        txn_date=dt.date(2026, 11, 1), idempotency_key="REC1",
    )
    session.commit()
    assert receipt.is_recovery is True
    assert ledger.is_balanced(session)


def test_核銷須管理員(session, 作業員, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    with pytest.raises(SlosError) as error:
        adjustments.write_off(
            session, 作業員, case, reason="失聯", txn_date=到期日, idempotency_key="WO2"
        )
    assert error.value.code is ErrorCode.E_PERMISSION_DENIED


def test_超過單筆調整上限非管理員不得執行(session, 帳務, 已撥款案件):
    case, _contract = 已撥款案件
    with pytest.raises(SlosError) as error:
        adjustments.adjust(
            session, 帳務, case, target_account="1100", increase=False,
            amount=Decimal("20000.00"), reason="測試", txn_date=到期日,
            idempotency_key="ADJ1",
        )
    assert error.value.code is ErrorCode.E_ADJUSTMENT_LIMIT


def test_已結清不得再轉回進行中(session, 管理員, 已撥款案件):
    case, _contract = 已撥款案件
    result = settlement.quote(session, 管理員, case, 到期日)
    settlement.post(session, 管理員, case, result.quote, amount=Decimal("50616.44"),
                    txn_date=到期日, idempotency_key="SET3")
    session.commit()
    with pytest.raises(SlosError) as error:
        case_service.set_status(session, 管理員, case, CaseStatus.ACTIVE)
    assert error.value.code is ErrorCode.E_STATE_TRANSITION


def test_唯讀角色不得進件(session, 唯讀):
    with pytest.raises(SlosError) as error:
        建立案件(session, 唯讀)
    assert error.value.code is ErrorCode.E_PERMISSION_DENIED
