"""Excel 交換（卯）。最多 14 張，表名繁體中文。

D07　帳本在資料庫。Excel 只做輸入、核對、匯出。Excel 無法不可變。
BR-030　預設匯出為遮蔽版。
黃底藍字＝輸入。黑字＝公式。公式格保護。
匯入：預覽→檢查→重複檢查→才入帳（用冪等鍵）。
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Iterable

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill, Protection
from openpyxl.utils import get_column_letter
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit, compliance, pii, reconciliation, reporting
from .config import Settings, get_settings
from .enums import AuditAction
from .labels import (
    ALLOCATION_BUCKET, INTEREST_METHOD, PAYMENT_METHOD, RATE_UNIT,
    RECON_STATUS, SUSPENSE_REASON, TXN_STATUS,
)
from .models import (
    Allocation, Case, ContractVersion, Customer, Disbursement, ExternalEvidence,
    Receipt, SuspenseEntry,
)
from .money import D, to_string
from .rbac import Actor, require

SHEETS: tuple[str, ...] = (
    "01_說明", "02_設定", "03_儀表板", "04_客戶", "05_案件", "06_契約", "07_交易",
    "08_沖帳", "09_分戶", "10_資金證據", "11_對帳", "12_暫收", "13_控制檢查", "14_示範",
)
OPTIONAL_SHEET = "15_指令"

INPUT_FILL = PatternFill("solid", fgColor="FFFFF2CC")
INPUT_FONT = Font(color="FF0000CC", bold=False)
FORMULA_FONT = Font(color="FF000000")
HEADER_FILL = PatternFill("solid", fgColor="FFEDEDED")
HEADER_FONT = Font(bold=True, color="FF000000")
WRAP = Alignment(vertical="top", wrap_text=True)


def _write_header(sheet, headers: list[str]) -> None:
    for column, title in enumerate(headers, start=1):
        cell = sheet.cell(row=1, column=column, value=title)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = WRAP
        sheet.column_dimensions[get_column_letter(column)].width = max(12, min(len(title) * 3, 40))
    sheet.freeze_panes = "A2"


def _write_rows(sheet, rows: Iterable[list[Any]], *, input_columns: set[int] | None = None) -> None:
    inputs = input_columns or set()
    for row_index, row in enumerate(rows, start=2):
        for column, value in enumerate(row, start=1):
            if isinstance(value, Decimal):
                value = to_string(value)
            elif isinstance(value, (dt.date, dt.datetime)):
                value = value.isoformat()
            elif isinstance(value, bool):
                value = "是" if value else "否"
            elif value is None:
                value = "MISSING"
            cell = sheet.cell(row=row_index, column=column, value=value)
            cell.alignment = WRAP
            if column in inputs:
                cell.fill = INPUT_FILL
                cell.font = INPUT_FONT
                cell.protection = Protection(locked=False)
            else:
                cell.font = FORMULA_FONT
                cell.protection = Protection(locked=True)


def _protect(sheet) -> None:
    sheet.protection.sheet = True
    sheet.protection.enable()


# --------------------------------------------------------------------------
def export(
    session: Session,
    actor: Actor,
    path: str,
    as_of: dt.date,
    *,
    masked: bool = True,
    include_commands: bool = True,
    settings: Settings | None = None,
) -> str:
    """匯出。預設遮蔽版（BR-030）；完整匯出需管理員並寫稽核。"""
    require(actor, "EXPORT_FULL" if not masked else "READ_MASKED")
    cfg = settings or get_settings()
    book = Workbook()
    book.remove(book.active)

    _sheet_readme(book, cfg, masked)
    _sheet_settings(book, cfg)
    _sheet_dashboard(book, session, as_of, cfg)
    _sheet_customers(book, session, masked)
    _sheet_cases(book, session, as_of, cfg, masked)
    _sheet_contracts(book, session)
    _sheet_transactions(book, session)
    _sheet_allocations(book, session)
    _sheet_subledger(book, session, as_of)
    _sheet_evidence(book, session)
    _sheet_reconciliation(book, session)
    _sheet_suspense(book, session)
    _sheet_controls(book, session, as_of)
    _sheet_demo(book, cfg)
    if include_commands:
        _sheet_commands(book)

    book.save(path)
    audit.record(
        session, actor, AuditAction.EXPORT, "Workbook", path,
        detail={"masked": masked, "as_of": str(as_of), "sheets": book.sheetnames},
        warning="完整匯出含未遮蔽個資。" if not masked else "N/A",
    )
    return path


def _sheet_readme(book: Workbook, cfg: Settings, masked: bool) -> None:
    sheet = book.create_sheet("01_說明")
    _write_header(sheet, ["項目", "內容"])
    rows = [
        ["系統名稱", "民間短期小額借款作業系統"],
        ["規格版本", "SLOS-V1.4-LOCKED"],
        ["帳本位置", "資料庫。Excel 只做輸入、核對、匯出，不是帳本（D07）。"],
        ["匯出模式", "遮蔽版" if masked else "完整版（需管理員，已寫稽核）"],
        ["顏色規則", "黃底藍字＝可輸入；黑字＝公式或系統產出，儲存格已保護。"],
        ["金額規則", "一律文字保存，2 位小數，幣別 TWD。禁止用 0 代表未知。"],
        ["未知資料", "只能填 MISSING（缺）／UNKNOWN（有但未辨識）／N/A（不適用）／PENDING（流程未完）／NOT_VERIFIED（未核驗）。"],
        ["匯入流程", "預覽 → 檢查 → 重複檢查 → 才入帳。同一冪等鍵不會重複記帳。"],
        ["本系統不做", "核貸、聯徵、評分、鑑價、募資、撮合、分潤、自動催收、法律意見。"],
        ["法律聲明", compliance.DISCLAIMER_ZH],
        ["備份", "Excel 不是備份。備份請用資料庫層級複製或還原點。"],
    ]
    _write_rows(sheet, rows)
    sheet.column_dimensions["B"].width = 90
    _protect(sheet)


def _sheet_settings(book: Workbook, cfg: Settings) -> None:
    sheet = book.create_sheet("02_設定")
    _write_header(sheet, ["設定項目", "值", "說明"])
    rows = [
        ["幣別", cfg.currency, "V1 入帳幣別僅 TWD（BR-025）。"],
        ["時區", cfg.timezone, "日期用日曆日，時間戳記含時區（BR-026）。"],
        ["金額容差", cfg.amount_tolerance, "尾差小於此值視為已清。"],
        ["到期日模式", cfg.maturity_date_mode, "D01：到期日＝撥款日＋借款天數。"],
        ["天數預設", "／".join(str(d) for d in cfg.term_days_presets), "畫面預設值。"],
        ["天數範圍", f"{cfg.term_days_min}–{cfg.term_days_max}", "超過上限拒絕建立。"],
        ["天數旗標", cfg.term_days_long_flag, "超過即打「天數偏長」，是作業政策，不是法律。"],
        ["民法 205 上限", cfg.cap_annual_205, "法規門檻參數，不是本系統核心利率。"],
        ["民法 204 門檻", cfg.threshold_annual_204, "滿一年且逾此值打旗標。"],
        ["民法 203 法定", cfg.statutory_annual_203, "無約定利率時之法定週年利率（參考）。"],
        ["沖帳順序", " → ".join(cfg.allocation_order) + " → SUSPENSE", "D09，系統設定不是法律判決。"],
        ["沖帳規則編號", cfg.allocation_rule_code, "每筆沖帳列都會記錄。"],
        ["利息認列", cfg.interest_income_recognition, "V1 收到才認列；應收引擎仍追該收多少。"],
        ["暫收提醒天數", cfg.suspense_alert_days, "超過即在儀表板標高。"],
        ["PAR 逾期天數", cfg.par_overdue_days, "PAR30 定義不得另行更改。"],
        ["對帳日期窗", cfg.recon_date_window_days, "流水日期正負天數。"],
        ["結清報價有效天數", cfg.settlement_quote_valid_days, "過期必須重新試算。"],
        ["單筆調整上限", cfg.adjustment_single_limit, "超過需管理員。"],
        ["備份份數", cfg.backup_copies, "開發環境每日日結複製 SQLite。"],
        ["設定檔位置", cfg.source, "系統核心不得寫死任何利率數字（BR-019）。"],
    ]
    _write_rows(sheet, rows, input_columns={2})
    sheet.column_dimensions["C"].width = 60
    _protect(sheet)


def _sheet_dashboard(book: Workbook, session: Session, as_of: dt.date, cfg: Settings) -> None:
    sheet = book.create_sheet("03_儀表板")
    board = reporting.dashboard(session, as_of, settings=cfg)
    _write_header(sheet, ["指標", "數值"])
    rows = [
        ["基準日", board.as_of],
        ["今日到期件數", board.due_today_count],
        ["今日到期金額", board.due_today_amount],
        ["今日應收合計", board.receivable_today],
        ["今日實收", board.received_today],
        ["今日撥款", board.disbursed_today],
        ["逾期件數", board.overdue_count],
        ["逾期金額", board.overdue_amount],
        ["部分已還件數", board.partially_repaid_count],
        ["待沖帳筆數", board.pending_allocation_count],
        ["暫收餘額", board.suspense_amount],
        ["暫收逾期未清筆數", board.suspense_aged_count],
        ["未對帳筆數", board.unreconciled_count],
    ]
    _write_rows(sheet, rows)
    start = len(rows) + 3
    sheet.cell(row=start, column=1, value="異常清單").font = HEADER_FONT
    for offset, item in enumerate(board.exceptions_zh or ["無"], start=1):
        sheet.cell(row=start + offset, column=1, value=item).font = FORMULA_FONT
    sheet.column_dimensions["A"].width = 70
    _protect(sheet)


def _sheet_customers(book: Workbook, session: Session, masked: bool) -> None:
    sheet = book.create_sheet("04_客戶")
    _write_header(sheet, ["客戶編號", "姓名", "身分證", "電話", "地址", "帳號"])
    rows = []
    for customer in session.scalars(select(Customer)).all():
        view = pii.customer_view(customer, masked=masked)
        rows.append([
            view["客戶編號"], view["姓名"], view["身分證"], view["電話"],
            view["地址"], view["帳號"],
        ])
    _write_rows(sheet, rows)
    _protect(sheet)


def _sheet_cases(
    book: Workbook, session: Session, as_of: dt.date, cfg: Settings, masked: bool
) -> None:
    sheet = book.create_sheet("05_案件")
    _write_header(sheet, [
        "案件編號", "借款人", "狀態", "資金來源", "撥款日", "天數", "到期日",
        "目前本金", "未收利息", "應收費用", "應收違約金", "逾期天數", "應收合計", "合規旗標",
    ])
    rows = []
    for case in session.scalars(select(Case)).all():
        page = reporting.case_page(session, case, as_of, masked=masked, settings=cfg)
        rows.append([
            page["案件編號"], page["借款人"], page["案件狀態"], "出借人自有資金",
            page["撥款日"], page["借款天數"], page["到期日"], page["目前本金"],
            page["未收利息"], page["應收費用"], page["應收違約金"], page["逾期天數"],
            page["今日應收合計"], "、".join(page["合規旗標"]) or "無",
        ])
    _write_rows(sheet, rows)
    _protect(sheet)


def _sheet_contracts(book: Workbook, session: Session) -> None:
    sheet = book.create_sheet("06_契約")
    _write_header(sheet, [
        "案件編號", "版本", "目前版本", "面額", "天數", "利率值", "利率單位", "計息方法",
        "期間固定利息", "固定利息不隨本金減少", "費用", "違約金規則", "違約金金額",
        "遲延利息規則", "沖帳覆寫", "來源", "起算日", "到期日", "借據編號",
    ])
    rows = []
    for version in session.scalars(select(ContractVersion)).all():
        case = session.get(Case, version.case_id)
        rows.append([
            case.case_no, version.version_no, version.is_current, D(version.face_amount),
            version.term_days, D(version.rate_value),
            RATE_UNIT.get(version.rate_unit, version.rate_unit),
            INTEREST_METHOD.get(version.interest_method, version.interest_method),
            version.period_flat_amount, version.sticky_interest, D(version.fee_amount),
            version.penalty_rule, D(version.penalty_amount), version.late_interest_rule,
            version.allocation_override, version.source, version.effective_date,
            version.maturity_date, version.contract_ref,
        ])
    _write_rows(sheet, rows)
    _protect(sheet)


def _sheet_transactions(book: Workbook, session: Session) -> None:
    sheet = book.create_sheet("07_交易")
    _write_header(sheet, [
        "類型", "案件編號", "交易日", "資金日", "金額", "方式", "流水", "冪等鍵",
        "狀態", "對帳狀態",
    ])
    rows = []
    for record in session.scalars(select(Disbursement)).all():
        case = session.get(Case, record.case_id)
        rows.append([
            "撥款", case.case_no, record.txn_date, record.value_date, D(record.amount),
            PAYMENT_METHOD.get(record.method, record.method), record.evidence_ref,
            record.idempotency_key, TXN_STATUS.get(record.status, record.status),
            RECON_STATUS.get(record.recon_status, record.recon_status),
        ])
    for record in session.scalars(select(Receipt)).all():
        case = session.get(Case, record.case_id) if record.case_id else None
        rows.append([
            "收回" if record.is_recovery else "收款",
            case.case_no if case else "MISSING", record.txn_date, record.value_date,
            D(record.amount), PAYMENT_METHOD.get(record.method, record.method),
            record.evidence_ref, record.idempotency_key,
            TXN_STATUS.get(record.status, record.status),
            RECON_STATUS.get(record.recon_status, record.recon_status),
        ])
    _write_rows(sheet, rows, input_columns={1, 2, 3, 4, 5, 6, 7, 8})
    _protect(sheet)


def _sheet_allocations(book: Workbook, session: Session) -> None:
    sheet = book.create_sheet("08_沖帳")
    _write_header(sheet, ["收款編號", "案件編號", "順序", "分量", "金額", "規則編號"])
    rows = []
    for record in session.scalars(select(Allocation)).all():
        case = session.get(Case, record.case_id) if record.case_id else None
        rows.append([
            record.receipt_id, case.case_no if case else "MISSING", record.sequence,
            ALLOCATION_BUCKET.get(record.bucket, record.bucket), D(record.amount),
            record.rule_code,
        ])
    _write_rows(sheet, rows)
    _protect(sheet)


def _sheet_subledger(book: Workbook, session: Session, as_of: dt.date) -> None:
    sheet = book.create_sheet("09_分戶")
    _write_header(sheet, ["案件編號", "本金", "已收利息", "已收費用", "已收違約金", "暫收貸方", "狀態"])
    rows = [
        [row["案件編號"], row["本金"], row["已收利息"], row["已收費用"],
         row["已收違約金"], row["暫收貸方"], row["狀態"]]
        for row in reporting.subledger(session, as_of)
    ]
    _write_rows(sheet, rows)
    _protect(sheet)


def _sheet_evidence(book: Workbook, session: Session) -> None:
    sheet = book.create_sheet("10_資金證據")
    _write_header(sheet, ["案件編號", "來源類型", "證據種類", "證據編號", "金額", "資金日", "核驗", "備註"])
    rows = []
    for record in session.scalars(select(ExternalEvidence)).all():
        case = session.get(Case, record.case_id) if record.case_id else None
        rows.append([
            case.case_no if case else "MISSING", record.ref_type, record.evidence_type,
            record.evidence_ref, record.amount, record.value_date, record.verified, record.note,
        ])
    _write_rows(sheet, rows, input_columns={4, 5, 6})
    _protect(sheet)


def _sheet_reconciliation(book: Workbook, session: Session) -> None:
    sheet = book.create_sheet("11_對帳")
    _write_header(sheet, ["類型", "編號", "交易日", "金額", "流水", "對帳狀態"])
    rows = [
        [row["類型"], row["編號"], row["交易日"], row["金額"], row["流水"],
         RECON_STATUS.get(row["對帳狀態"], row["對帳狀態"])]
        for row in reconciliation.unreconciled(session)
    ]
    _write_rows(sheet, rows)
    _protect(sheet)


def _sheet_suspense(book: Workbook, session: Session) -> None:
    sheet = book.create_sheet("12_暫收")
    _write_header(sheet, ["收款編號", "案件編號", "金額", "原因", "掛帳日", "沖銷日", "備註"])
    rows = []
    for record in session.scalars(select(SuspenseEntry)).all():
        case = session.get(Case, record.case_id) if record.case_id else None
        rows.append([
            record.receipt_id, case.case_no if case else "MISSING", D(record.amount),
            SUSPENSE_REASON.get(record.reason, record.reason), record.opened_date,
            record.cleared_date or "PENDING", record.note,
        ])
    _write_rows(sheet, rows)
    _protect(sheet)


def _sheet_controls(book: Workbook, session: Session, as_of: dt.date) -> None:
    sheet = book.create_sheet("13_控制檢查")
    _write_header(sheet, ["檢查項目", "結果", "說明"])
    rows = [
        [check.name_zh, "通過" if check.passed else "未通過", check.detail_zh]
        for check in reporting.control_checks(session, as_of)
    ]
    _write_rows(sheet, rows)
    sheet.column_dimensions["C"].width = 70
    _protect(sheet)


def _sheet_demo(book: Workbook, cfg: Settings) -> None:
    sheet = book.create_sheet("14_示範")
    demo = cfg.demo
    _write_header(sheet, ["項目", "值", "說明"])
    rows = [
        ["案件編號", demo["case_no"], "示範案，不是利率規則。"],
        ["撥款日", demo["disburse_date"], "D01：到期日＝撥款日＋天數。"],
        ["本金", demo["principal"], "金額一律文字，2 位小數。"],
        ["天數", demo["term_days"], "示範天數＝30（D13）。"],
        ["到期日", "2026-10-11", "2026-09-11＋30。"],
        ["利率", demo["rate_value"], "示範利率是參數，預設 0，避免把任何利率寫進核心。"],
        ["利率單位", demo["rate_unit"], "年／日／本期／固定金額。"],
        ["計息方法", INTEREST_METHOD.get(demo["interest_method"], demo["interest_method"]), "期間定額／按日365。"],
        ["費用", "0.00", "示範不設費用。"],
        ["銀行流水", "MISSING", "缺流水仍可入帳，對帳狀態＝待對（D06）。"],
        ["已收款", "0.00", "尚未收款。"],
        ["撥款後狀態", "進行中", "建立案件不是核貸。"],
        ["借款人顯示", "借款人甲", "不得虛構銀行名、餘額、聯徵、所得、完整地址、評分。"],
        ["身分證遮蔽", "A123****89", "畫面預設遮蔽。"],
    ]
    _write_rows(sheet, rows)
    sheet.column_dimensions["C"].width = 60
    _protect(sheet)


def _sheet_commands(book: Workbook) -> None:
    from .commands import COMMAND_HELP

    sheet = book.create_sheet(OPTIONAL_SHEET)
    _write_header(sheet, ["指令", "名稱", "說明"])
    rows = [[code, meta["name"], meta["help"]] for code, meta in COMMAND_HELP.items()]
    _write_rows(sheet, rows)
    sheet.column_dimensions["C"].width = 70
    _protect(sheet)


# --------------------------------------------------------------------------
@dataclass
class ImportRow:
    sheet: str
    row_no: int
    values: dict[str, Any]
    problems_zh: list[str]


def preview_import(path: str, sheet_name: str = "07_交易") -> list[ImportRow]:
    """匯入預覽。先檢查再說，絕不直接入帳（D07：有人改表再匯入可能重複）。"""
    book = load_workbook(path, data_only=True)
    if sheet_name not in book.sheetnames:
        return []
    sheet = book[sheet_name]
    headers = [cell.value for cell in sheet[1]]
    rows: list[ImportRow] = []
    seen_keys: set[str] = set()
    for index, raw in enumerate(sheet.iter_rows(min_row=2, values_only=True), start=2):
        values = dict(zip(headers, raw))
        problems: list[str] = []
        key = str(values.get("冪等鍵") or "").strip()
        if not key:
            problems.append("缺冪等鍵，禁止匯入入帳（BR-015）。")
        elif key in seen_keys:
            problems.append("同一檔內冪等鍵重複，只會入帳一次。")
        seen_keys.add(key)
        if not str(values.get("流水") or "").strip():
            problems.append("流水為空字串，必須填真實編號或哨兵詞（BR-027）。")
        if not str(values.get("案件編號") or "").strip():
            problems.append("沒有案件編號，只能掛暫收「無法認列」（BR-014）。")
        rows.append(ImportRow(sheet_name, index, values, problems))
    return rows
