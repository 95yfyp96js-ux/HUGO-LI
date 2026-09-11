"""卯／午：Excel 表、匯入預覽、備份腳本、指令列。"""
from __future__ import annotations

import datetime as dt
from pathlib import Path

import pytest
from openpyxl import load_workbook

from slos import closing, excel
from slos.cli import main
from slos.commands import COMMAND_HELP
from slos.errors import ErrorCode, SlosError

到期日 = dt.date(2026, 10, 11)


@pytest.mark.p0
def test_匯出十四張繁中表且示範表為三十天案(session, 管理員, 已撥款案件, tmp_path):
    path = tmp_path / "匯出.xlsx"
    excel.export(session, 管理員, str(path), 到期日)
    session.commit()
    book = load_workbook(path)
    assert book.sheetnames[:14] == list(excel.SHEETS)
    demo = {row[0]: row[1] for row in book["14_示範"].iter_rows(min_row=2, values_only=True)}
    assert demo["天數"] == 30
    assert demo["到期日"] == "2026-10-11"
    assert demo["利率"] == "0"


@pytest.mark.p0
def test_匯出預設為遮蔽版(session, 管理員, 已撥款案件, tmp_path):
    path = tmp_path / "遮蔽.xlsx"
    excel.export(session, 管理員, str(path), 到期日)
    session.commit()
    book = load_workbook(path)
    rows = list(book["04_客戶"].iter_rows(min_row=2, values_only=True))
    assert rows and rows[0][2] == "A123****89"


def test_唯讀角色不得做完整匯出(session, 唯讀, 已撥款案件, tmp_path):
    with pytest.raises(SlosError) as error:
        excel.export(session, 唯讀, str(tmp_path / "x.xlsx"), 到期日, masked=False)
    assert error.value.code is ErrorCode.E_PERMISSION_DENIED


def test_公式格受保護輸入格為黃底藍字(session, 管理員, 已撥款案件, tmp_path):
    path = tmp_path / "格式.xlsx"
    excel.export(session, 管理員, str(path), 到期日)
    session.commit()
    sheet = load_workbook(path)["02_設定"]
    assert sheet.protection.sheet is True
    輸入格 = sheet.cell(row=2, column=2)
    assert 輸入格.font.color.rgb.endswith("0000CC")
    assert 輸入格.fill.fgColor.rgb.endswith("FFF2CC")


@pytest.mark.p0
def test_匯入預覽會擋沒有冪等鍵與空流水(tmp_path):
    from openpyxl import Workbook

    path = tmp_path / "匯入.xlsx"
    book = Workbook()
    sheet = book.active
    sheet.title = "07_交易"
    sheet.append(["類型", "案件編號", "交易日", "資金日", "金額", "方式", "流水", "冪等鍵"])
    sheet.append(["收款", "L20260911-001", "2026-09-21", "2026-09-21", "1000.00", "BANK", "", ""])
    sheet.append(["收款", "", "2026-09-21", "2026-09-21", "1000.00", "BANK", "TXN-1", "K1"])
    sheet.append(["收款", "L20260911-001", "2026-09-21", "2026-09-21", "1000.00", "BANK", "TXN-1", "K1"])
    book.save(path)

    rows = excel.preview_import(str(path))
    assert len(rows) == 3
    assert any("缺冪等鍵" in p for p in rows[0].problems_zh)
    assert any("流水為空字串" in p for p in rows[0].problems_zh)
    assert any("沒有案件編號" in p for p in rows[1].problems_zh)
    assert any("冪等鍵重複" in p for p in rows[2].problems_zh)


@pytest.mark.p0
def test_備份腳本存在且會保留設定份數(tmp_path):
    db = tmp_path / "slos.db"
    db.write_bytes(b"fake-sqlite")
    backup_dir = tmp_path / "backup"
    first = closing.backup_sqlite(str(db), str(backup_dir))
    assert Path(first).exists()
    assert Path(first).read_bytes() == b"fake-sqlite"


def test_Excel不是備份的說明有寫在說明表(session, 管理員, 已撥款案件, tmp_path):
    path = tmp_path / "說明.xlsx"
    excel.export(session, 管理員, str(path), 到期日)
    session.commit()
    values = [row[1] for row in load_workbook(path)["01_說明"].iter_rows(min_row=2, values_only=True)]
    assert any("Excel 不是備份" in str(v) for v in values)


def test_指令說明全為繁體中文():
    for code, meta in COMMAND_HELP.items():
        assert code.startswith("/")
        assert not meta["name"].isascii()
        assert not meta["help"].isascii()


def test_指令列支援斜線指令(capsys):
    assert main(["/help"]) == 0
    out = capsys.readouterr().out
    assert "進件" in out and "本系統永不核貸" in out
