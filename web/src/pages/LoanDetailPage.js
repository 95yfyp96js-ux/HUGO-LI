import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, newIdempotencyKey } from "../lib/api";
import { date, dateTime, money, percent, REPAYMENT_METHOD_LABELS } from "../lib/format";
import { DataTable, ErrorBanner, Field, KpiCard, Loading, Money, PageHeader, RiskGradeBadge, StatusBadge, Tabs, } from "../components/ui";
import { useAuth } from "../lib/auth";
const TABS = [
    { id: "overview", label: "放款總覽" },
    { id: "schedule", label: "還款期程" },
    { id: "payments", label: "收款紀錄" },
    { id: "balance", label: "餘額" },
    { id: "events", label: "金流事件" },
    { id: "chain", label: "續借鏈" },
    { id: "collection", label: "催收" },
];
const EVENT_LABELS = {
    DISBURSEMENT: "撥款",
    INTEREST_ACCRUAL: "計息",
    FEE_CHARGE: "收費",
    PAYMENT: "收款",
    PAYMENT_REVERSAL: "收款沖銷",
    ADJUSTMENT: "調整",
    WRITE_OFF: "呆帳沖銷",
    SETTLEMENT: "結清",
};
export function LoanDetailPage() {
    const { id } = useParams();
    const { can } = useAuth();
    const queryClient = useQueryClient();
    const [tab, setTab] = useState("overview");
    const [action, setAction] = useState(null);
    const { data: loan, isLoading, error } = useQuery({
        queryKey: ["loan", id],
        queryFn: () => api(`/api/loans/${id}`),
    });
    const { data: balance } = useQuery({
        queryKey: ["loan-balance", id],
        queryFn: () => api(`/api/loans/${id}/balance`),
        enabled: Boolean(id),
    });
    const { data: chain } = useQuery({
        queryKey: ["loan-chain", id],
        queryFn: () => api(`/api/loans/${id}/chain`),
        enabled: Boolean(id) && tab === "chain",
    });
    if (isLoading)
        return _jsx(Loading, {});
    if (error)
        return _jsx(ErrorBanner, { error: error });
    if (!loan)
        return null;
    const totalOutstanding = (loan.outstandingPrincipalCents + loan.outstandingInterestCents + loan.outstandingFeeCents) / 100;
    const risk = loan.application?.riskAssessments[0];
    const isServicing = ["ACTIVE", "DUE_SOON", "DUE", "OVERDUE", "DEFAULTED"].includes(loan.status);
    return (_jsxs("div", { children: [_jsx(PageHeader, { title: loan.loanNumber, subtitle: `${loan.customer.name}（${loan.customer.customerNumber}）`, actions: _jsxs(_Fragment, { children: [isServicing && can("PAYMENT_CREATE") && (_jsx(Link, { to: `/payments/new?loanId=${loan.id}`, className: "btn-primary", children: "\u6536\u6B3E" })), isServicing && can("LOAN_RENEW") && (_jsx("button", { className: "btn-secondary", onClick: () => setAction("renew"), children: "\u7E8C\u501F" })), isServicing && can("LOAN_EXTEND") && (_jsx("button", { className: "btn-secondary", onClick: () => setAction("extend"), children: "\u5C55\u671F" }))] }) }), _jsxs("div", { className: "mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5", children: [_jsx(KpiCard, { label: "\u653E\u6B3E\u91D1\u984D", value: money(loan.principalCents / 100) }), _jsx(KpiCard, { label: "\u5269\u9918\u672C\u91D1", value: money(loan.outstandingPrincipalCents / 100) }), _jsx(KpiCard, { label: "\u5269\u9918\u5229\u606F", value: money(loan.outstandingInterestCents / 100) }), _jsx(KpiCard, { label: "\u7E3D\u6B20\u6B3E", value: money(totalOutstanding), tone: loan.status === "OVERDUE" ? "danger" : "default" }), _jsxs("div", { className: "card flex flex-col justify-center gap-2 p-4", children: [_jsx(StatusBadge, { status: loan.status }), _jsxs("div", { className: "flex items-center gap-2 text-xs text-slate-500", children: ["\u98A8\u96AA ", _jsx(RiskGradeBadge, { grade: risk?.grade ?? null })] })] })] }), _jsx(Tabs, { tabs: TABS, active: tab, onChange: setTab }), tab === "overview" && (_jsxs("div", { className: "grid gap-4 lg:grid-cols-2", children: [_jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-4 text-sm font-semibold text-slate-700", children: "\u653E\u6B3E\u689D\u4EF6\u5FEB\u7167\uFF08\u6210\u7ACB\u6642\u9396\u5B9A\uFF0C\u7522\u54C1\u6539\u50F9\u4E0D\u5F71\u97FF\u672C\u7B46\uFF09" }), loan.snapshot ? (_jsxs("dl", { className: "grid grid-cols-2 gap-4", children: [_jsx(Field, { label: "\u5229\u7387", children: percent(loan.snapshot.ratePercent, loan.snapshot.rateUnit) }), _jsxs(Field, { label: "\u671F\u6578", children: [loan.snapshot.termMonths, " \u671F"] }), _jsx(Field, { label: "\u9084\u6B3E\u65B9\u5F0F", children: REPAYMENT_METHOD_LABELS[loan.snapshot.repaymentMethod] ?? loan.snapshot.repaymentMethod }), _jsx(Field, { label: "\u8A08\u606F\u65B9\u5F0F", children: loan.snapshot.calculationMethod }), _jsxs(Field, { label: "\u7522\u54C1\u7248\u672C", children: ["v", loan.snapshot.productVersion] }), _jsx(Field, { label: "\u5B9A\u50F9\u7248\u672C", children: loan.snapshot.pricingVersion }), _jsx(Field, { label: "\u8D77\u59CB\u65E5", children: date(loan.startDate) }), _jsx(Field, { label: "\u5230\u671F\u65E5", children: date(loan.maturityDate) })] })) : (_jsx("p", { className: "text-sm text-slate-500", children: "\u5C1A\u7121\u5FEB\u7167" }))] }), _jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-4 text-sm font-semibold text-slate-700", children: "\u64A5\u6B3E\u7D00\u9304" }), loan.disbursements.length === 0 ? (_jsx("p", { className: "text-sm text-slate-500", children: "\u5C1A\u672A\u64A5\u6B3E" })) : (_jsx("div", { className: "space-y-3", children: loan.disbursements.map((d) => (_jsxs("div", { className: "rounded-lg border border-slate-200 p-3 text-sm", children: [_jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "font-medium", children: d.disbursementNumber }), _jsx(StatusBadge, { status: d.status === "COMPLETED" ? "PAID_OFF" : d.status })] }), _jsx("div", { className: "tabular mt-1 text-slate-600", children: money(d.amountCents / 100) }), _jsxs("div", { className: "mt-1 text-xs text-slate-500", children: [d.method, " \u30FB ", dateTime(d.processedAt)] }), d.reference && (_jsx("div", { className: "mt-1 font-mono text-xs text-slate-400", children: d.reference }))] }, d.id))) })), loan.extensions.length > 0 && (_jsxs(_Fragment, { children: [_jsx("h2", { className: "mb-3 mt-5 text-sm font-semibold text-slate-700", children: "\u5C55\u671F\u7D00\u9304" }), _jsx("div", { className: "space-y-2", children: loan.extensions.map((e) => (_jsxs("div", { className: "rounded-lg border border-slate-200 p-3 text-sm", children: [_jsxs("div", { children: [date(e.previousMaturityDate), " \u2192 ", date(e.newMaturityDate), "\uFF08+", e.extensionMonths, " \u500B\u6708\uFF09"] }), _jsxs("div", { className: "mt-1 text-xs text-slate-500", children: ["\u5C55\u671F\u8CBB ", money(e.feeCents / 100), " \u30FB ", e.reason] })] }, e.id))) })] })), loan.settlement && (_jsxs("div", { className: "mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm", children: [_jsx("div", { className: "font-medium text-emerald-800", children: "\u5DF2\u7D50\u6E05" }), _jsxs("div", { className: "tabular mt-1 text-emerald-700", children: ["\u7E3D\u9084\u6B3E ", money(loan.settlement.totalPaidCents / 100)] }), _jsx("div", { className: "mt-1 text-xs text-emerald-600", children: dateTime(loan.settlement.settledAt) })] }))] })] })), tab === "schedule" && (_jsx(DataTable, { rows: loan.scheduleLines, rowKey: (row) => row.id, empty: "\u5C1A\u7121\u9084\u6B3E\u671F\u7A0B", columns: [
                    { header: "期數", cell: (row) => _jsx("span", { className: "tabular", children: row.installmentNumber }) },
                    { header: "應繳日", cell: (row) => date(row.dueDate) },
                    { header: "本金", cell: (row) => _jsx(Money, { value: row.principalDueCents / 100 }), className: "text-right" },
                    { header: "利息", cell: (row) => _jsx(Money, { value: row.interestDueCents / 100 }), className: "text-right" },
                    { header: "費用", cell: (row) => _jsx(Money, { value: row.feeDueCents / 100 }), className: "text-right" },
                    {
                        header: "應繳合計",
                        cell: (row) => _jsx(Money, { value: row.totalDueCents / 100, className: "font-medium" }),
                        className: "text-right",
                    },
                    {
                        header: "已繳",
                        cell: (row) => (_jsx(Money, { value: (row.principalPaidCents + row.interestPaidCents + row.feePaidCents) / 100 })),
                        className: "text-right",
                    },
                    {
                        header: "狀態",
                        cell: (row) => (_jsx("span", { className: `text-xs font-medium ${row.status === "PAID"
                                ? "text-emerald-600"
                                : row.status === "OVERDUE"
                                    ? "text-rose-600"
                                    : row.status === "PARTIALLY_PAID"
                                        ? "text-amber-600"
                                        : "text-slate-500"}`, children: row.status === "PAID"
                                ? "已繳清"
                                : row.status === "OVERDUE"
                                    ? "逾期"
                                    : row.status === "PARTIALLY_PAID"
                                        ? "部分繳納"
                                        : "未到期" })),
                    },
                ] })), tab === "payments" && (_jsx(DataTable, { rows: loan.payments, rowKey: (row) => row.id, empty: "\u5C1A\u7121\u6536\u6B3E\u7D00\u9304", columns: [
                    { header: "收款編號", cell: (row) => _jsx("span", { className: "tabular", children: row.paymentNumber }) },
                    { header: "收款日", cell: (row) => dateTime(row.paidAt) },
                    {
                        header: "金額",
                        cell: (row) => _jsx(Money, { value: row.amountCents / 100, className: "font-medium" }),
                        className: "text-right",
                    },
                    {
                        header: "本金",
                        cell: (row) => _jsx(Money, { value: (row.allocations[0]?.principalAmountCents ?? 0) / 100 }),
                        className: "text-right",
                    },
                    {
                        header: "利息",
                        cell: (row) => _jsx(Money, { value: (row.allocations[0]?.interestAmountCents ?? 0) / 100 }),
                        className: "text-right",
                    },
                    {
                        header: "費用",
                        cell: (row) => _jsx(Money, { value: (row.allocations[0]?.feeAmountCents ?? 0) / 100 }),
                        className: "text-right",
                    },
                    { header: "方式", cell: (row) => row.method },
                    { header: "狀態", cell: (row) => _jsx(StatusBadge, { status: row.status === "CONFIRMED" ? "PAID" : row.status }) },
                ] })), tab === "balance" && balance && (_jsxs("div", { className: "grid gap-4 lg:grid-cols-2", children: [_jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-1 text-sm font-semibold text-slate-700", children: "\u76EE\u524D\u9918\u984D" }), _jsx("p", { className: "mb-4 text-xs text-slate-500", children: "\u7531\u91D1\u6D41\u4E8B\u4EF6\u5E33\u672C\u91CD\u65B0\u8A08\u7B97\uFF0C\u53EF\u8207\u653E\u6B3E\u5E33\u6236\u6B04\u4F4D\u5C0D\u5E33\u3002" }), _jsxs("dl", { className: "space-y-3", children: [_jsx(BalanceRow, { label: "\u5269\u9918\u672C\u91D1", value: balance.outstandingPrincipal }), _jsx(BalanceRow, { label: "\u5269\u9918\u5229\u606F", value: balance.outstandingInterest }), _jsx(BalanceRow, { label: "\u5269\u9918\u8CBB\u7528", value: balance.outstandingFees }), _jsx("div", { className: "border-t border-slate-200 pt-3", children: _jsx(BalanceRow, { label: "\u7E3D\u6B20\u6B3E", value: balance.totalOutstanding, strong: true }) })] })] }), _jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-4 text-sm font-semibold text-slate-700", children: "\u7D2F\u8A08\u5DF2\u9084" }), _jsxs("dl", { className: "space-y-3", children: [_jsx(BalanceRow, { label: "\u5DF2\u9084\u672C\u91D1", value: balance.principalPaid }), _jsx(BalanceRow, { label: "\u5DF2\u4ED8\u5229\u606F", value: balance.interestPaid }), _jsx(BalanceRow, { label: "\u5DF2\u4ED8\u8CBB\u7528", value: balance.feesPaid }), _jsx("div", { className: "border-t border-slate-200 pt-3", children: _jsx(BalanceRow, { label: "\u7E3D\u9084\u6B3E", value: balance.totalPaid, strong: true }) })] })] })] })), tab === "events" && (_jsx(DataTable, { rows: loan.moneyEvents, rowKey: (row) => row.id, empty: "\u5C1A\u7121\u91D1\u6D41\u4E8B\u4EF6", columns: [
                    { header: "發生時間", cell: (row) => dateTime(row.occurredAt) },
                    {
                        header: "事件",
                        cell: (row) => (_jsx("span", { className: "font-medium", children: EVENT_LABELS[row.type] ?? row.type })),
                    },
                    {
                        header: "金額",
                        cell: (row) => _jsx(Money, { value: row.amountCents / 100 }),
                        className: "text-right",
                    },
                    {
                        header: "說明",
                        cell: (row) => _jsx("span", { className: "font-mono text-xs text-slate-500", children: row.metadata }),
                    },
                ] })), tab === "chain" && (_jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-4 text-sm font-semibold text-slate-700", children: "\u7E8C\u501F\u93C8" }), !chain || chain.chain.length <= 1 ? (_jsx("p", { className: "text-sm text-slate-500", children: "\u6B64\u653E\u6B3E\u6C92\u6709\u7E8C\u501F\u7D00\u9304\u3002" })) : (_jsx("ol", { className: "space-y-3", children: chain.chain.map((link) => (_jsxs("li", { className: "flex items-start gap-3", children: [_jsx("span", { className: "mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700", children: link.sequence }), _jsxs("div", { className: "flex-1 rounded-lg border border-slate-200 p-3", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs(Link, { to: `/loans/${link.loanId}`, className: `font-medium ${link.loanId === loan.id ? "text-slate-900" : "text-brand-600 hover:underline"}`, children: [link.loanNumber, link.loanId === loan.id && _jsx("span", { className: "ml-2 text-xs text-slate-400", children: "\uFF08\u76EE\u524D\uFF09" })] }), _jsx(StatusBadge, { status: link.status })] }), _jsx("div", { className: "tabular mt-1 text-sm text-slate-600", children: money(link.principal) }), link.renewedFrom && (_jsxs("div", { className: "mt-1 text-xs text-slate-500", children: ["\u7E8C\u501F\u81EA ", link.renewedFrom, " \u30FB ", link.reason] }))] })] }, link.loanId))) }))] })), tab === "collection" && (_jsx(DataTable, { rows: loan.collectionCases, rowKey: (row) => row.id, empty: "\u6B64\u653E\u6B3E\u6C92\u6709\u50AC\u6536\u6848\u4EF6", columns: [
                    {
                        header: "案件編號",
                        cell: (row) => (_jsx(Link, { to: `/collections/${row.id}`, className: "font-medium text-brand-600 hover:underline", children: row.caseNumber })),
                    },
                    { header: "狀態", cell: (row) => _jsx(StatusBadge, { status: row.status, kind: "collection" }) },
                    { header: "優先度", cell: (row) => _jsx(StatusBadge, { status: row.priority, kind: "priority" }) },
                    { header: "逾期天數", cell: (row) => _jsx("span", { className: "tabular", children: row.daysOverdue }) },
                ] })), action && (_jsx(LoanActionDialog, { loanId: loan.id, kind: action, outstanding: totalOutstanding, onClose: () => setAction(null), onDone: () => {
                    setAction(null);
                    queryClient.invalidateQueries({ queryKey: ["loan", id] });
                    queryClient.invalidateQueries({ queryKey: ["loans"] });
                } }))] }));
}
function BalanceRow({ label, value, strong }) {
    return (_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("dt", { className: "text-sm text-slate-600", children: label }), _jsx("dd", { className: `tabular text-sm ${strong ? "text-lg font-semibold" : "font-medium"}`, children: money(value) })] }));
}
function LoanActionDialog({ loanId, kind, outstanding, onClose, onDone, }) {
    const [reason, setReason] = useState("");
    const [additionalAmount, setAdditionalAmount] = useState("");
    const [termMonths, setTermMonths] = useState("3");
    const [extensionMonths, setExtensionMonths] = useState("1");
    const [fee, setFee] = useState("0");
    const [idempotencyKey] = useState(newIdempotencyKey);
    const mutation = useMutation({
        mutationFn: () => kind === "renew"
            ? api(`/api/loans/${loanId}/renew`, {
                method: "POST",
                idempotencyKey,
                body: {
                    reason,
                    additionalAmount: additionalAmount || undefined,
                    termMonths: Number(termMonths),
                },
            })
            : api(`/api/loans/${loanId}/extend`, {
                method: "POST",
                body: { reason, extensionMonths: Number(extensionMonths), fee: fee || 0 },
            }),
        onSuccess: onDone,
    });
    return (_jsx("div", { className: "fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4", children: _jsxs("div", { className: "w-full max-w-lg rounded-t-2xl bg-white p-6 sm:rounded-2xl", children: [_jsx("h2", { className: "text-lg font-semibold", children: kind === "renew" ? "續借" : "展期" }), _jsx("p", { className: "mt-1 text-sm text-slate-500", children: kind === "renew"
                        ? "續借會結清原放款並建立新放款，原放款歷史完整保留。"
                        : "展期沿用同一筆放款，僅延長到期日與未繳期數。" }), _jsx("div", { className: "mt-4 rounded-lg bg-slate-50 p-3 text-sm", children: _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-500", children: "\u76EE\u524D\u7E3D\u6B20\u6B3E" }), _jsx("span", { className: "tabular font-semibold", children: money(outstanding) })] }) }), _jsxs("div", { className: "mt-4 space-y-4", children: [kind === "renew" ? (_jsxs(_Fragment, { children: [_jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "loan-f1", children: "\u589E\u8CB8\u91D1\u984D\uFF08\u53EF\u7559\u7A7A\uFF09" }), _jsx("input", { id: "loan-f1", className: "input tabular", inputMode: "decimal", value: additionalAmount, onChange: (e) => setAdditionalAmount(e.target.value), placeholder: "0" })] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "loan-f2", children: "\u65B0\u653E\u6B3E\u671F\u6578" }), _jsx("input", { id: "loan-f2", className: "input tabular", inputMode: "numeric", value: termMonths, onChange: (e) => setTermMonths(e.target.value) })] })] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "loan-f3", children: "\u5C55\u5EF6\u6708\u6578" }), _jsx("input", { id: "loan-f3", className: "input tabular", inputMode: "numeric", value: extensionMonths, onChange: (e) => setExtensionMonths(e.target.value) })] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "loan-f4", children: "\u5C55\u671F\u8CBB" }), _jsx("input", { id: "loan-f4", className: "input tabular", inputMode: "decimal", value: fee, onChange: (e) => setFee(e.target.value) })] })] })), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "loan-f5", children: "\u539F\u56E0 *" }), _jsx("textarea", { id: "loan-f5", className: "input", rows: 2, value: reason, onChange: (e) => setReason(e.target.value), required: true })] })] }), _jsx(ErrorBanner, { error: mutation.error }), _jsxs("div", { className: "mt-5 flex justify-end gap-2", children: [_jsx("button", { className: "btn-secondary", onClick: onClose, disabled: mutation.isPending, children: "\u53D6\u6D88" }), _jsx("button", { className: "btn-primary", onClick: () => mutation.mutate(), disabled: mutation.isPending || !reason.trim(), children: mutation.isPending ? "處理中…" : "確認" })] })] }) }));
}
