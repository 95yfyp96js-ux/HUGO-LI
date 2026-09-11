"""規格守則：核心不寫死利率、不核貸、不募資、不出法律意見、介面全繁中。

這些測試不是功能測試，是把使用者指定的三條硬規則釘在程式碼上。
"""
from __future__ import annotations

import ast
import pathlib
import re
from decimal import Decimal

import pytest

from slos import compliance, excel, labels
from slos.commands import COMMAND_HELP
from slos.enums import CaseStatus, FundingSource
from slos.errors import MESSAGES_ZH_HANT, ErrorCode
from slos.models import Base

套件目錄 = pathlib.Path(__file__).resolve().parent.parent / "slos"

#: 引擎裡容許出現的數字：日計數基準與結構常數，沒有一個是利率。
容許數字: set[float] = {0, 1, 2, 8, 32, 360, 365}

核心模組: tuple[str, ...] = (
    "interest.py", "compliance.py", "receivable.py", "allocation.py",
    "positions.py", "dates.py", "ledger.py", "collection.py", "disbursement.py",
    "settlement.py", "extension.py", "adjustments.py", "reconciliation.py",
)


def _常數(path: pathlib.Path) -> tuple[set[float], set[str]]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    numbers: set[float] = set()
    decimals: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant):
            if isinstance(node.value, bool):
                continue
            if isinstance(node.value, (int, float)):
                numbers.add(node.value)
            elif isinstance(node.value, str):
                try:
                    Decimal(node.value)
                except Exception:  # noqa: BLE001
                    continue
                decimals.add(node.value)
    return numbers, decimals


@pytest.mark.p0
def test_核心程式不得出現利率字面量():
    """BR-019：系統核心不得寫死任何利率數字。門檻一律取自設定檔。"""
    for name in 核心模組:
        numbers, decimals = _常數(套件目錄 / name)
        outliers = {n for n in numbers if n not in 容許數字}
        assert not outliers, f"{name} 出現不該存在的數字常數：{sorted(outliers)}"
        rate_like = {d for d in decimals if Decimal(d) != 0}
        assert not rate_like, f"{name} 出現疑似利率的 Decimal 字面量：{sorted(rate_like)}"


@pytest.mark.p0
def test_全套件禁止浮點數字面量():
    """〇-7：金額一律 Decimal。禁止 JavaScript number，Python 端等同禁止 float。"""
    for path in sorted(套件目錄.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        floats = [
            node.value for node in ast.walk(tree)
            if isinstance(node, ast.Constant) and isinstance(node.value, float)
        ]
        assert not floats, f"{path.name} 出現浮點數字面量：{floats}"


@pytest.mark.p0
def test_資料模型不得有投資人資金池募資等資料表():
    """申／D10：V1 禁止投資人、資金池、群眾募資、分潤、評分、鑑價。"""
    禁止字 = (
        "investor", "fund_pool", "funding_pool", "crowd", "profit_share",
        "credit_score", "scoring", "appraisal", "bureau", "marketplace", "tranche",
    )
    for table in Base.metadata.tables:
        for word in 禁止字:
            assert word not in table.lower(), f"資料表 {table} 觸犯 V1 禁止清單"
    columns = [
        f"{table}.{column.name}"
        for table, obj in Base.metadata.tables.items()
        for column in obj.columns
    ]
    for name in columns:
        for word in 禁止字:
            assert word not in name.lower(), f"欄位 {name} 觸犯 V1 禁止清單"


@pytest.mark.p0
def test_案件沒有核准狀態也沒有可手改的餘額欄():
    """BR-001／戊：本系統永不核貸；餘額由已入帳交易推導。"""
    狀態 = {s.value for s in CaseStatus}
    for word in ("APPROV", "REJECT", "UNDERWRIT", "PENDING_DISBURSE"):
        assert not any(word in s for s in 狀態), f"案件狀態不得出現 {word}"
    案件欄位 = {c.name for c in Base.metadata.tables["cases"].columns}
    for word in ("balance", "outstanding", "current_amount", "approval"):
        assert not any(word in c for c in 案件欄位), f"案件表不得有 {word} 欄位"


@pytest.mark.p0
def test_資金來源只有出借人自有資金():
    assert [s.value for s in FundingSource] == ["OWNER"]


@pytest.mark.p0
def test_系統只給旗標不給法律意見():
    """合規旗標段：不得自動宣告整筆借貸無效，不得自動入罪。"""
    assert "不產生法律意見" in compliance.DISCLAIMER_ZH
    assert "不核貸" in compliance.DISCLAIMER_ZH
    assert len(compliance.LEGAL_REVIEW_TOPICS) == 5
    來源 = (套件目錄 / "compliance.py").read_text(encoding="utf-8")
    for word in ("無效", "有罪", "違法認定", "判決"):
        assert f'return "{word}' not in 來源


@pytest.mark.p0
def test_Excel表名為繁體中文且最多十五張():
    assert len(excel.SHEETS) == 14
    for name in excel.SHEETS:
        assert re.match(r"^\d{2}_[^\x00-\x7F]+$", name), f"{name} 不是繁中表名"
    assert excel.OPTIONAL_SHEET == "15_指令"


@pytest.mark.p0
def test_列舉標籤與錯誤訊息全為繁體中文():
    for code in ErrorCode:
        assert not MESSAGES_ZH_HANT[code].isascii()
    for table in (
        labels.CASE_STATUS, labels.INTEREST_METHOD, labels.RATE_UNIT,
        labels.ALLOCATION_BUCKET, labels.RECON_STATUS, labels.COMPLIANCE_FLAG,
    ):
        for value in table.values():
            assert not value.isascii(), f"標籤必須是繁體中文：{value}"


@pytest.mark.p0
def test_指令清單涵蓋規格辰所列的十三個指令():
    必要 = {
        "/intake", "/disburse", "/collect", "/recon", "/aging", "/stmt", "/adjust",
        "/reverse", "/settle", "/extend", "/dayclose", "/monthclose", "/writeoff",
    }
    assert 必要 <= set(COMMAND_HELP)


def test_設定檔是資料不是程式碼():
    """門檻改動不需要動程式。"""
    from slos.config import DEFAULT_PATH, load_settings

    assert DEFAULT_PATH.suffix == ".json"
    settings = load_settings(DEFAULT_PATH)
    assert settings.cap_annual_205 == Decimal("0.16")
    assert settings.demo["rate_value"] == "0"
