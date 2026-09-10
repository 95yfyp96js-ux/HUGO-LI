"""寅：個資遮蔽、權限、稽核不可竄改。"""
from __future__ import annotations


import pytest

from slos import pii
from slos.enums import AuditAction
from slos.errors import ErrorCode, SlosError
from slos.models import AuditLog, Customer
from slos.rbac import require
from tests.conftest import 建立案件


@pytest.mark.p0
def test_個資畫面預設遮蔽(session, 管理員):
    case, _c, _f = 建立案件(session, 管理員)
    session.commit()
    customer = session.query(Customer).one()
    view = pii.customer_view(customer)
    assert view["身分證"] == "A123****89"
    assert view["姓名"] != customer.name
    assert "MISSING" in view["電話"] or view["電話"].startswith("0")


@pytest.mark.p0
def test_遮蔽格式符合規格(session):
    assert pii.mask_national_id("A123456789") == "A123****89"
    assert pii.mask_phone("0912345678") == "09**-***678"
    assert pii.mask_account("123456781234") == "********1234"
    assert pii.mask_address("台北市大安區忠孝東路四段1號").endswith("（以下遮蔽）")
    assert "忠孝東路" not in pii.mask_address("台北市大安區忠孝東路四段1號")


@pytest.mark.p0
def test_看完整個資須管理員且必寫稽核(session, 管理員, 作業員):
    case, _c, _f = 建立案件(session, 管理員)
    session.commit()
    customer = session.query(Customer).one()
    with pytest.raises(SlosError) as error:
        pii.reveal(session, 作業員, customer)
    assert error.value.code is ErrorCode.E_PERMISSION_DENIED

    full = pii.reveal(session, 管理員, customer)
    session.commit()
    assert full["身分證"] == "A123456789"
    logs = session.query(AuditLog).filter(
        AuditLog.action == AuditAction.VIEW_FULL_PII.value
    ).all()
    assert len(logs) == 1


@pytest.mark.p0
def test_禁止蒐集特種個人資料(session):
    with pytest.raises(SlosError) as error:
        pii.reject_special_category({"note": "借款人有精神科病歷"})
    assert error.value.code is ErrorCode.E_SPECIAL_CATEGORY_PII


def test_單人操作與覆核會寫警告稽核(session, 管理員, 已撥款案件):
    logs = session.query(AuditLog).filter(
        AuditLog.action == AuditAction.SEGREGATION_WARNING.value
    ).all()
    assert logs and "四眼" in logs[0].warning


def test_稽核必記所有會動錢或動契約的指令(session, 管理員, 已撥款案件):
    actions = {log.action for log in session.query(AuditLog).all()}
    assert {"CREATE", "POST"} <= actions


def test_唯讀角色沒有匯出完整資料的權限(唯讀):
    with pytest.raises(SlosError) as error:
        require(唯讀, "EXPORT_FULL")
    assert error.value.code is ErrorCode.E_PERMISSION_DENIED
