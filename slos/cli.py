"""指令列介面（辰／酉）。介面未做前，先指令列與 Excel。

畫面文案、CLI 說明、錯誤說明一律繁體中文；斜線指令保留英文便於複製。
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from decimal import Decimal
from typing import Any, Callable

from sqlalchemy.orm import Session

from . import (
    adjustments, cases as case_service, closing, collection, compliance, disbursement,
    excel, extension, periods, pii, positions, reconciliation, reporting, settlement,
)
from .commands import COMMAND_HELP, INTAKE_FORM_ZH
from .config import get_settings
from .db import make_engine, make_session_factory
from .enums import InterestMethod, PaymentMethod, RateUnit, Role
from .errors import SlosError
from .models import Case, JournalEntry, create_all
from .money import D, to_string
from .rbac import Actor
from .sentinels import MISSING


def _date(value: str) -> dt.date:
    return dt.date.fromisoformat(value)


def _amount(value: str) -> Decimal:
    return D(value)


def _print(title: str, rows: dict[str, Any] | list[Any]) -> None:
    print(f"\n── {title} ──")
    if isinstance(rows, dict):
        width = max((len(str(k)) for k in rows), default=4)
        for key, value in rows.items():
            if isinstance(value, Decimal):
                value = to_string(value)
            print(f"{str(key).ljust(width)}　{value}")
    else:
        for item in rows:
            print(f"・{item}")


def _get_case(session: Session, case_no: str) -> Case:
    from sqlalchemy import select

    case = session.scalar(select(Case).where(Case.case_no == case_no))
    if case is None:
        from .errors import ErrorCode

        raise SlosError(ErrorCode.E_CASE_NOT_FOUND, detail=case_no)
    return case


def _actor(args: argparse.Namespace) -> Actor:
    return Actor(name=args.actor, role=args.role)


def _session(args: argparse.Namespace) -> Session:
    engine = make_engine(args.database)
    create_all(engine)
    return make_session_factory(engine)()


# --------------------------------------------------------------------------
def cmd_help(args: argparse.Namespace) -> int:
    _print("可用指令", [f"{code}　{meta['name']}　{meta['help']}" for code, meta in COMMAND_HELP.items()])
    print("\n" + INTAKE_FORM_ZH)
    print("\n" + compliance.DISCLAIMER_ZH)
    return 0


def cmd_intake(args: argparse.Namespace) -> int:
    session, actor = _session(args), _actor(args)
    data = case_service.IntakeInput(
        customer_name=args.borrower,
        principal=args.principal,
        term_days=args.days,
        rate_value=args.rate,
        rate_unit=args.rate_unit,
        interest_method=args.method,
        disburse_date=args.date,
        period_flat_amount=args.flat_amount,
        sticky_interest=args.sticky,
        fee_amount=args.fee,
        penalty_rule=args.penalty_rule,
        penalty_amount=args.penalty_amount,
        contract_ref=args.contract_ref,
        cash_flow_method=args.cash_flow,
        national_id=args.national_id,
        phone=args.phone,
        address=args.address,
    )
    case, contract, flags = case_service.intake(session, actor, data)
    session.commit()
    _print("進件結果", {
        "案件編號": case.case_no,
        "借款人（遮蔽）": pii.mask_name(args.borrower),
        "契約版本": contract.version_no,
        "本金": D(contract.face_amount),
        "借款天數": contract.term_days,
        "到期日": contract.maturity_date,
        "狀態": "草稿（建立案件不是核貸）",
    })
    _print("合規旗標（不是判決）", [f"{f.label_zh}：{f.detail_zh}" for f in flags] or ["無"])
    print("\n" + compliance.DISCLAIMER_ZH)
    return 0


def cmd_disburse(args: argparse.Namespace) -> int:
    session, actor = _session(args), _actor(args)
    case = _get_case(session, args.case)
    view = disbursement.preview(
        session, case, args.amount, args.method, args.date, evidence_ref=args.evidence
    )
    _print("撥款預覽", {
        "案件編號": view.case_no, "金額": view.amount, "方式": view.method_zh,
        "交易日": view.txn_date, "資金日": view.value_date, "到期日": view.maturity_date,
        "流水": view.evidence_ref, "對帳狀態": view.recon_status_zh,
    })
    _print("分錄", view.entries_zh)
    if view.warnings_zh:
        _print("提醒", view.warnings_zh)
    if not args.confirm:
        print("\n未加 --confirm，僅預覽，未入帳。")
        return 0
    record, result = disbursement.post(
        session, actor, case, amount=args.amount, txn_date=args.date,
        idempotency_key=args.key, method=args.method, evidence_ref=args.evidence,
    )
    session.commit()
    _print("入帳結果", {
        "傳票號": result.entry.entry_no, "訊息": result.message_zh,
        "案件狀態": case.status,
        "目前本金": positions.principal_outstanding(session, case.id),
    })
    return 0


def cmd_collect(args: argparse.Namespace) -> int:
    session, actor = _session(args), _actor(args)
    case = _get_case(session, args.case) if args.case else None
    view = collection.preview(
        session, case, args.amount, args.date, method=args.method,
        payer_designation=args.designation, evidence_ref=args.evidence,
    )
    _print("收款預覽", {
        "案件編號": view.case_no, "金額": view.amount, "基準日": view.as_of,
        "無法認列": "是" if view.unidentified else "否",
    })
    if view.plan:
        _print("沖帳預覽", [
            f"{line.bucket_zh}　{to_string(line.amount)}　（{line.source_zh}／規則 {line.rule_code}）"
            for line in view.plan.lines
        ])
        _print("沖帳說明", view.plan.notes_zh)
    _print("分錄", view.entries_zh)
    if view.warnings_zh:
        _print("提醒", view.warnings_zh)
    if not args.confirm:
        print("\n未加 --confirm，僅預覽，未入帳。")
        return 0
    receipt, result, plan = collection.post(
        session, actor, case, amount=args.amount, txn_date=args.date,
        idempotency_key=args.key, method=args.method, evidence_ref=args.evidence,
        payer_designation=args.designation,
    )
    session.commit()
    _print("入帳結果", {
        "收款編號": receipt.id, "傳票號": result.entry.entry_no, "訊息": result.message_zh,
        "案件狀態": case.status if case else "無案件（暫收）",
    })
    return 0


def cmd_settle(args: argparse.Namespace) -> int:
    session, actor = _session(args), _actor(args)
    case = _get_case(session, args.case)
    result = settlement.quote(session, actor, case, args.date)
    session.commit()
    _print("結清試算", {
        "報價編號": result.quote.quote_no, "基準日": result.quote.as_of_date,
        "有效至": result.quote.valid_until, "本金": D(result.quote.principal),
        "利息": D(result.quote.interest), "費用": D(result.quote.fee),
        "違約金": D(result.quote.penalty), "合計": D(result.quote.total),
    })
    _print("說明", result.notes_zh)
    if not args.confirm:
        print("\n未加 --confirm，僅試算，未入帳。結清試算 ≠ 已結清。")
        return 0
    amount = args.amount if args.amount is not None else D(result.quote.total)
    record, receipt = settlement.post(
        session, actor, case, result.quote, amount=amount, txn_date=args.date,
        idempotency_key=args.key, evidence_ref=args.evidence,
    )
    session.commit()
    _print("結清入帳", {
        "收款編號": receipt.id, "尾差": D(record.residual), "案件狀態": case.status,
    })
    return 0


def cmd_extend(args: argparse.Namespace) -> int:
    session, actor = _session(args), _actor(args)
    case = _get_case(session, args.case)
    view = extension.preview(session, case, args.days, args.date)
    _print("展期預覽", {
        "案件編號": view.case_no, "原到期日": view.old_maturity,
        "新到期日": view.new_maturity, "新天數": view.new_term_days,
        "帶入本金": view.carried_principal, "未收利息": view.outstanding_interest,
    })
    _print("說明", view.notes_zh)
    if not args.confirm:
        print("\n未加 --confirm，僅預覽，未建立新版本。")
        return 0
    record, version = extension.extend(
        session, actor, case, new_term_days=args.days, from_date=args.date
    )
    session.commit()
    _print("展期結果", {
        "案件編號": case.case_no, "新契約版本": version.version_no,
        "新到期日": version.maturity_date, "利息滾入本金": "否（民法第 207 條）",
    })
    return 0


def cmd_reverse(args: argparse.Namespace) -> int:
    session, actor = _session(args), _actor(args)
    entry = session.get(JournalEntry, args.entry_id)
    if entry is None:
        print("查無此傳票。")
        return 1
    if not args.confirm:
        _print("沖正預覽", {
            "傳票號": entry.entry_no, "交易類型": entry.txn_type, "原因": args.reason,
        })
        print("\n未加 --confirm，僅預覽，未入帳。")
        return 0
    result = adjustments.reverse_entry(
        session, actor, entry, reason=args.reason, idempotency_key=args.key
    )
    session.commit()
    _print("沖正結果", {"沖正傳票": result.entry.entry_no, "訊息": result.message_zh})
    return 0


def cmd_adjust(args: argparse.Namespace) -> int:
    session, actor = _session(args), _actor(args)
    case = _get_case(session, args.case) if args.case else None
    if not args.confirm:
        _print("調整預覽", {
            "案件編號": args.case or "無", "科目": args.account,
            "方向": "增加" if args.increase else "減少", "金額": args.amount,
            "原因": args.reason,
        })
        print("\n未加 --confirm，僅預覽，未入帳。")
        return 0
    record = adjustments.adjust(
        session, actor, case, target_account=args.account, increase=args.increase,
        amount=args.amount, reason=args.reason, txn_date=args.date,
        idempotency_key=args.key,
    )
    session.commit()
    _print("調整結果", {"調整編號": record.id, "金額": D(record.amount)})
    return 0


def cmd_writeoff(args: argparse.Namespace) -> int:
    session, actor = _session(args), _actor(args)
    case = _get_case(session, args.case)
    if not args.confirm:
        _print("核銷預覽", {
            "案件編號": case.case_no,
            "未償本金": positions.principal_outstanding(session, case.id),
            "原因": args.reason, "需管理員": "是",
        })
        print("\n未加 --confirm，僅預覽，未入帳。核銷不刪案件。")
        return 0
    record = adjustments.write_off(
        session, actor, case, reason=args.reason, txn_date=args.date,
        idempotency_key=args.key, amount=args.amount,
    )
    session.commit()
    _print("核銷結果", {
        "核銷編號": record.id, "金額": D(record.amount), "案件狀態": case.status,
        "說明": "核銷不刪案件；之後收款走收回。",
    })
    return 0


def cmd_recon(args: argparse.Namespace) -> int:
    session, actor = _session(args), _actor(args)
    rows: list[reconciliation.StatementRow] = []
    if args.statement:
        payload = json.loads(open(args.statement, encoding="utf-8").read())
        for item in payload:
            rows.append(reconciliation.StatementRow(
                statement_ref=str(item["流水"]),
                amount=D(str(item["金額"])),
                value_date=_date(str(item["資金日"])),
                direction=str(item["方向"]),
                note=str(item.get("備註", "N/A")),
            ))
    result = reconciliation.run(session, actor, rows)
    session.commit()
    _print("對帳結果", {
        "已配": result.matched, "重複": result.duplicates,
        "未配": result.unmatched, "缺證據": result.no_evidence,
    })
    _print("說明", result.notes_zh)
    _print("未對帳清單", [
        f"{row['類型']}　編號 {row['編號']}　{row['交易日']}　{to_string(row['金額'])}　流水 {row['流水']}"
        for row in reconciliation.unreconciled(session)
    ] or ["無"])
    return 0


def cmd_aging(args: argparse.Namespace) -> int:
    session = _session(args)
    rows, par = reporting.aging(session, args.date)
    _print("帳齡（分量分開列）", [
        f"{row.bucket_zh}　件數 {row.case_count}　本金 {to_string(row.principal)}　"
        f"利息 {to_string(row.interest)}　費用 {to_string(row.fee)}　違約金 {to_string(row.penalty)}　"
        f"合計 {to_string(row.total)}"
        for row in rows
    ])
    _print("PAR30", {"逾期天數 ≥30 的未償本金": par})
    return 0


def cmd_stmt(args: argparse.Namespace) -> int:
    session = _session(args)
    case = _get_case(session, args.case)
    rows = reporting.statement(session, case, args.date)
    _print(f"對帳單　{case.case_no}", [
        "　".join(f"{k}={v}" for k, v in row.items()) for row in rows
    ] or ["無交易"])
    return 0


def cmd_case(args: argparse.Namespace) -> int:
    session = _session(args)
    case = _get_case(session, args.case)
    page = reporting.case_page(session, case, args.date, masked=not args.full)
    if args.full:
        from .models import Customer

        pii.reveal(session, _actor(args), session.get(Customer, case.customer_id))
        session.commit()
    _print(f"案件頁　{case.case_no}", page)
    return 0


def cmd_dash(args: argparse.Namespace) -> int:
    session = _session(args)
    board = reporting.dashboard(session, args.date)
    _print("儀表板", {
        "基準日": board.as_of, "今日到期件數": board.due_today_count,
        "今日到期金額": board.due_today_amount, "今日應收": board.receivable_today,
        "今日實收": board.received_today, "今日撥款": board.disbursed_today,
        "逾期件數": board.overdue_count, "逾期金額": board.overdue_amount,
        "部分已還": board.partially_repaid_count, "待沖帳": board.pending_allocation_count,
        "暫收": board.suspense_amount, "暫收逾期未清": board.suspense_aged_count,
        "未對帳": board.unreconciled_count,
    })
    _print("異常", board.exceptions_zh or ["無"])
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    session = _session(args)
    checks = reporting.control_checks(session, args.date)
    _print("控制檢查", [
        f"{'通過' if c.passed else '未通過'}　{c.name_zh}　{c.detail_zh}" for c in checks
    ])
    return 0 if all(c.passed for c in checks) else 1


def cmd_dayclose(args: argparse.Namespace) -> int:
    session, actor = _session(args), _actor(args)
    result = closing.day_close(session, actor, args.date)
    session.commit()
    _print("日結", {"基準日": result.as_of, "落地快照": result.snapshots})
    _print("控制檢查", [
        f"{'通過' if c.passed else '未通過'}　{c.name_zh}" for c in result.checks
    ])
    _print("說明", result.notes_zh)
    return 0


def cmd_monthclose(args: argparse.Namespace) -> int:
    session, actor = _session(args), _actor(args)
    if args.reopen:
        period = periods.reopen(session, args.date, actor, args.reason or "")
        session.commit()
        _print("重開帳期", {"帳期": period.period, "原因": period.reopen_reason})
        return 0
    period, checks = closing.month_close(session, actor, args.date)
    session.commit()
    _print("月結", {"帳期": period, "狀態": "已關帳"})
    _print("控制檢查", [
        f"{'通過' if c.passed else '未通過'}　{c.name_zh}" for c in checks
    ])
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    session, actor = _session(args), _actor(args)
    path = excel.export(session, actor, args.output, args.date, masked=not args.full)
    session.commit()
    _print("匯出", {
        "檔案": path, "模式": "完整版（已寫稽核）" if args.full else "遮蔽版（預設）",
        "提醒": "Excel 不是帳本，也不是備份。",
    })
    return 0


def cmd_demo(args: argparse.Namespace) -> int:
    """示範案（亥）。示範利率是參數，預設 0，不得把利率寫進核心。"""
    session, actor = _session(args), _actor(args)
    cfg = get_settings()
    demo = cfg.demo
    data = case_service.IntakeInput(
        customer_name="借款人甲",
        principal=D(demo["principal"]),
        term_days=int(demo["term_days"]),
        rate_value=D(demo["rate_value"]),
        rate_unit=demo["rate_unit"],
        interest_method=demo["interest_method"],
        disburse_date=_date(demo["disburse_date"]),
        national_id="A123456789",
        contract_ref=MISSING,
        cash_flow_method=MISSING,
    )
    case, contract, flags = case_service.intake(session, actor, data)
    disbursement.post(
        session, actor, case, amount=D(demo["principal"]),
        txn_date=_date(demo["disburse_date"]), idempotency_key=f"DEMO-DISB-{case.case_no}",
        evidence_ref=MISSING,
    )
    session.commit()
    _print("示範案", reporting.case_page(session, case, contract.maturity_date))
    _print("合規旗標（不是判決）", [f"{f.label_zh}：{f.detail_zh}" for f in flags] or ["無"])
    print("\n不得虛構銀行名、銀行餘額、聯徵、所得、完整地址、評分。")
    return 0


# --------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="slos",
        description="民間短期小額借款作業系統 V1.4（SLOS-V1.4-LOCKED）。本系統永不核貸、不募資、不產出法律意見。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--database", default=None, help="資料庫連線字串，預設讀環境變數 SLOS_DATABASE_URL。")
    parser.add_argument("--actor", default="系統管理員", help="操作者姓名，會寫進稽核。")
    parser.add_argument("--role", default=Role.ADMIN.value,
                        choices=[r.value for r in Role], help="操作者角色。")
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add(name: str, handler: Callable[[argparse.Namespace], int], help_zh: str):
        sub = subparsers.add_parser(name.lstrip("/"), help=help_zh, description=help_zh)
        sub.set_defaults(handler=handler)
        return sub

    add("help", cmd_help, "列出所有指令與進件表單。")

    p = add("intake", cmd_intake, COMMAND_HELP["/intake"]["help"])
    p.add_argument("--borrower", required=True, help="借款人姓名。")
    p.add_argument("--principal", required=True, type=_amount, help="本金（契約面額）。")
    p.add_argument("--days", required=True, type=int, help="借款天數：7／10／15／30／自訂 1–365。")
    p.add_argument("--rate", default="0", type=_amount, help="利率值。系統核心不寫死任何利率。")
    p.add_argument("--rate-unit", default=RateUnit.ANNUAL.value,
                   choices=[u.value for u in RateUnit], help="利率單位：年／日／本期／固定金額。")
    p.add_argument("--method", default=InterestMethod.ACT_365.value,
                   choices=[m.value for m in InterestMethod], help="計息方法：期間定額／按日365。")
    p.add_argument("--date", required=True, type=_date, help="撥款日 YYYY-MM-DD。")
    p.add_argument("--flat-amount", default=None, type=_amount, help="期間固定利息金額。")
    p.add_argument("--sticky", action="store_true", help="固定利息不隨本金減少。")
    p.add_argument("--fee", default="0", type=_amount, help="契約費用。")
    p.add_argument("--penalty-rule", default="N/A", help="違約金規則：無／有（寫金額或規則）。")
    p.add_argument("--penalty-amount", default="0", type=_amount, help="違約金金額。")
    p.add_argument("--contract-ref", default=MISSING, help="借據編號，沒有請填 MISSING。")
    p.add_argument("--cash-flow", default=MISSING, help="金流：銀行／現金／MISSING。")
    p.add_argument("--national-id", default=MISSING, help="身分證字號，畫面預設遮蔽。")
    p.add_argument("--phone", default=MISSING, help="電話。")
    p.add_argument("--address", default=MISSING, help="地址。")

    p = add("disburse", cmd_disburse, COMMAND_HELP["/disburse"]["help"])
    p.add_argument("--case", required=True, help="案件編號。")
    p.add_argument("--amount", required=True, type=_amount, help="實撥金額。")
    p.add_argument("--date", required=True, type=_date, help="交易日。")
    p.add_argument("--key", required=True, help="冪等鍵。會動錢的操作必須帶。")
    p.add_argument("--method", default=PaymentMethod.BANK.value,
                   choices=[m.value for m in PaymentMethod], help="付款方式。")
    p.add_argument("--evidence", default=MISSING, help="銀行流水，沒有填 MISSING。")
    p.add_argument("--confirm", action="store_true", help="確認入帳。不加只做預覽。")

    p = add("collect", cmd_collect, COMMAND_HELP["/collect"]["help"])
    p.add_argument("--case", default=None, help="案件編號。沒有則掛暫收「無法認列」。")
    p.add_argument("--amount", required=True, type=_amount, help="收款金額。")
    p.add_argument("--date", required=True, type=_date, help="交易日。")
    p.add_argument("--key", required=True, help="冪等鍵。")
    p.add_argument("--method", default=PaymentMethod.BANK.value,
                   choices=[m.value for m in PaymentMethod], help="收款方式。")
    p.add_argument("--evidence", default=MISSING, help="銀行流水。")
    p.add_argument("--designation", default=None,
                   help='付款人指定抵充，JSON：{"INTEREST": "500.00"}。')
    p.add_argument("--confirm", action="store_true", help="確認入帳。不加只做預覽。")

    p = add("settle", cmd_settle, COMMAND_HELP["/settle"]["help"])
    p.add_argument("--case", required=True, help="案件編號。")
    p.add_argument("--date", required=True, type=_date, help="基準日。")
    p.add_argument("--amount", default=None, type=_amount, help="實收金額，預設等於報價合計。")
    p.add_argument("--key", default="SETTLE", help="冪等鍵。")
    p.add_argument("--evidence", default=MISSING, help="銀行流水。")
    p.add_argument("--confirm", action="store_true", help="確認入帳。不加只做試算。")

    p = add("extend", cmd_extend, COMMAND_HELP["/extend"]["help"])
    p.add_argument("--case", required=True, help="案件編號。")
    p.add_argument("--days", required=True, type=int, help="新的借款天數。")
    p.add_argument("--date", default=None, type=_date, help="展期起日，預設為原到期日。")
    p.add_argument("--confirm", action="store_true", help="確認建立新契約版本。")

    p = add("reverse", cmd_reverse, COMMAND_HELP["/reverse"]["help"])
    p.add_argument("--entry-id", required=True, type=int, help="要沖正的傳票編號。")
    p.add_argument("--reason", required=True, help="沖正原因。")
    p.add_argument("--key", required=True, help="冪等鍵。")
    p.add_argument("--confirm", action="store_true", help="確認入帳。")

    p = add("adjust", cmd_adjust, COMMAND_HELP["/adjust"]["help"])
    p.add_argument("--case", default=None, help="案件編號。")
    p.add_argument("--account", required=True, help="科目代碼，例如 1100。")
    p.add_argument("--increase", action="store_true", help="增加該科目；不加為減少。")
    p.add_argument("--amount", required=True, type=_amount, help="調整金額。")
    p.add_argument("--reason", required=True, help="調整原因。")
    p.add_argument("--date", required=True, type=_date, help="交易日。")
    p.add_argument("--key", required=True, help="冪等鍵。")
    p.add_argument("--confirm", action="store_true", help="確認入帳。")

    p = add("writeoff", cmd_writeoff, COMMAND_HELP["/writeoff"]["help"])
    p.add_argument("--case", required=True, help="案件編號。")
    p.add_argument("--reason", required=True, help="核銷原因。")
    p.add_argument("--date", required=True, type=_date, help="交易日。")
    p.add_argument("--key", required=True, help="冪等鍵。")
    p.add_argument("--amount", default=None, type=_amount, help="核銷金額，預設為未償本金。")
    p.add_argument("--confirm", action="store_true", help="確認入帳。需管理員。")

    p = add("recon", cmd_recon, COMMAND_HELP["/recon"]["help"])
    p.add_argument("--statement", default=None,
                   help='銀行流水 JSON 檔：[{"流水":"...","金額":"...","資金日":"YYYY-MM-DD","方向":"IN"}]')

    p = add("aging", cmd_aging, COMMAND_HELP["/aging"]["help"])
    p.add_argument("--date", required=True, type=_date, help="基準日。")

    p = add("stmt", cmd_stmt, COMMAND_HELP["/stmt"]["help"])
    p.add_argument("--case", required=True, help="案件編號。")
    p.add_argument("--date", required=True, type=_date, help="基準日。")

    p = add("case", cmd_case, COMMAND_HELP["/case"]["help"])
    p.add_argument("--case", required=True, help="案件編號。")
    p.add_argument("--date", required=True, type=_date, help="基準日。")
    p.add_argument("--full", action="store_true", help="看完整個資，需管理員，會寫稽核。")

    p = add("dash", cmd_dash, COMMAND_HELP["/dash"]["help"])
    p.add_argument("--date", required=True, type=_date, help="基準日。")

    p = add("check", cmd_check, COMMAND_HELP["/check"]["help"])
    p.add_argument("--date", required=True, type=_date, help="基準日。")

    p = add("dayclose", cmd_dayclose, COMMAND_HELP["/dayclose"]["help"])
    p.add_argument("--date", required=True, type=_date, help="日結基準日。")

    p = add("monthclose", cmd_monthclose, COMMAND_HELP["/monthclose"]["help"])
    p.add_argument("--date", required=True, type=_date, help="該月任一日。")
    p.add_argument("--reopen", action="store_true", help="重開帳期，需管理員並填原因。")
    p.add_argument("--reason", default=None, help="重開原因。")

    p = add("export", cmd_export, COMMAND_HELP["/export"]["help"])
    p.add_argument("--output", required=True, help="輸出 .xlsx 路徑。")
    p.add_argument("--date", required=True, type=_date, help="基準日。")
    p.add_argument("--full", action="store_true", help="完整匯出（未遮蔽），需管理員。")

    p = add("demo", cmd_demo, "建立示範案 L20260911-001（30 天，利率為參數，預設 0）。")
    return parser


def main(argv: list[str] | None = None) -> int:
    args_in = list(sys.argv[1:] if argv is None else argv)
    parser = build_parser()
    # 斜線指令保留英文便於複製：只把第一個指令代碼的斜線去掉，不動路徑等其他參數。
    known = {name.lstrip("/") for name in COMMAND_HELP} | {"help", "demo"}
    for index, item in enumerate(args_in):
        if item.startswith("-"):
            continue
        if item.startswith("/") and item.lstrip("/") in known:
            args_in[index] = item.lstrip("/")
        break
    args = parser.parse_args(args_in)
    try:
        return int(args.handler(args))
    except SlosError as error:
        print(f"\n錯誤　{error.message_zh}", file=sys.stderr)
        print(f"錯誤碼　{error.code.value}", file=sys.stderr)
        if error.detail:
            print(f"細節　{error.detail}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
