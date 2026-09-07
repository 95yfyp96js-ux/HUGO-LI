import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { date, dateTime, money, percent } from "../lib/format";
import { DataTable, ErrorBanner, Field, KpiCard, Loading, Money, PageHeader, RiskGradeBadge, StatusBadge, Tabs, } from "../components/ui";
const TABS = [
    { id: "overview", label: "總覽" },
    { id: "loans", label: "放款" },
    { id: "payments", label: "還款" },
    { id: "applications", label: "申請" },
    { id: "risk", label: "風險" },
    { id: "collections", label: "催收" },
];
export function CustomerDetailPage() {
    const { id } = useParams();
    const [tab, setTab] = useState("overview");
    const { data, isLoading, error } = useQuery({
        queryKey: ["customer360", id],
        queryFn: () => api(`/api/customers/${id}/360`),
    });
    if (isLoading)
        return _jsx(Loading, {});
    if (error)
        return _jsx(ErrorBanner, { error: error });
    if (!data)
        return null;
    const { profile, summary } = data;
    return (_jsxs("div", { children: [_jsx(PageHeader, { title: `${profile.name}`, subtitle: `${profile.customerNumber} ・ ${profile.identityNumberMasked}`, actions: _jsxs(_Fragment, { children: [_jsx(Link, { to: `/lending/applications/new?customerId=${profile.id}`, className: "btn-primary", children: "\u5EFA\u7ACB\u653E\u6B3E\u7533\u8ACB" }), _jsx(Link, { to: `/payments/new?customerId=${profile.id}`, className: "btn-secondary", children: "\u6536\u6B3E" })] }) }), _jsxs("div", { className: "mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4", children: [_jsx(KpiCard, { label: "\u76EE\u524D\u7E3D\u6B20\u6B3E", value: money(summary.totalOutstanding), tone: "danger" }), _jsx(KpiCard, { label: "\u5269\u9918\u672C\u91D1", value: money(summary.outstandingPrincipal) }), _jsx(KpiCard, { label: "\u6B77\u53F2\u501F\u6B3E\u7E3D\u984D", value: money(summary.totalBorrowed) }), _jsx(KpiCard, { label: "\u6B77\u53F2\u9084\u6B3E\u7E3D\u984D", value: money(summary.totalRepaid), tone: "success" })] }), _jsx(Tabs, { tabs: TABS, active: tab, onChange: setTab }), tab === "overview" && (_jsxs("div", { className: "grid gap-4 lg:grid-cols-2", children: [_jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-4 text-sm font-semibold text-slate-700", children: "\u5BA2\u6236\u8CC7\u6599" }), _jsxs("dl", { className: "grid grid-cols-2 gap-4", children: [_jsx(Field, { label: "\u72C0\u614B", children: _jsx(StatusBadge, { status: profile.status }) }), _jsx(Field, { label: "\u98A8\u96AA\u7B49\u7D1A", children: _jsx(RiskGradeBadge, { grade: summary.currentRiskGrade }) }), _jsx(Field, { label: "\u96FB\u8A71", children: profile.phone }), _jsx(Field, { label: "\u96FB\u5B50\u90F5\u4EF6", children: profile.email ?? "—" }), _jsx(Field, { label: "\u51FA\u751F\u65E5\u671F", children: date(profile.dateOfBirth) }), _jsx(Field, { label: "\u6708\u6536\u5165", children: money(profile.monthlyIncome) }), _jsx(Field, { label: "\u4EFB\u8077\u516C\u53F8", children: profile.employer ?? "—" }), _jsx(Field, { label: "\u5EFA\u6A94\u65E5\u671F", children: date(profile.createdAt) }), _jsx("div", { className: "col-span-2", children: _jsx(Field, { label: "\u5730\u5740", children: profile.address ?? "—" }) })] })] }), _jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-4 text-sm font-semibold text-slate-700", children: "\u5F80\u4F86\u6458\u8981" }), _jsxs("dl", { className: "grid grid-cols-2 gap-4", children: [_jsxs(Field, { label: "\u6D3B\u8E8D\u653E\u6B3E", children: [summary.activeLoanCount, " \u4EF6"] }), _jsxs(Field, { label: "\u5DF2\u7D50\u6E05\u653E\u6B3E", children: [summary.paidOffLoanCount, " \u4EF6"] }), _jsxs(Field, { label: "\u903E\u671F\u653E\u6B3E", children: [summary.overdueLoanCount, " \u4EF6"] }), _jsxs(Field, { label: "\u5E73\u5747\u903E\u671F\u5929\u6578", children: [summary.averageDaysLate, " \u5929"] }), _jsx(Field, { label: "\u5DF2\u4ED8\u5229\u606F", children: money(summary.interestPaid) }), _jsx(Field, { label: "\u61C9\u6536\u5229\u606F", children: money(summary.outstandingInterest) }), _jsxs(Field, { label: "\u7E8C\u501F\u6B21\u6578", children: [summary.renewalCount, " \u6B21"] }), _jsxs(Field, { label: "\u5C55\u671F\u6B21\u6578", children: [summary.extensionCount, " \u6B21"] }), _jsx(Field, { label: "\u6700\u8FD1\u9084\u6B3E", children: dateTime(summary.lastPaymentAt) }), _jsx(Field, { label: "\u6700\u8FD1\u9084\u6B3E\u91D1\u984D", children: money(summary.lastPaymentAmount) })] })] })] })), tab === "loans" && (_jsx(DataTable, { rows: data.loans, rowKey: (row) => row.id, empty: "\u6B64\u5BA2\u6236\u5C1A\u7121\u653E\u6B3E\u7D00\u9304", columns: [
                    {
                        header: "放款編號",
                        cell: (row) => (_jsx(Link, { to: `/loans/${row.id}`, className: "font-medium text-brand-600 hover:underline", children: row.loanNumber })),
                    },
                    { header: "狀態", cell: (row) => _jsx(StatusBadge, { status: row.status }) },
                    { header: "放款金額", cell: (row) => _jsx(Money, { value: row.principal }), className: "text-right" },
                    {
                        header: "剩餘本金",
                        cell: (row) => _jsx(Money, { value: row.outstandingPrincipal }),
                        className: "text-right",
                    },
                    {
                        header: "總欠款",
                        cell: (row) => _jsx(Money, { value: row.totalOutstanding, className: "font-medium" }),
                        className: "text-right",
                    },
                    { header: "利率", cell: (row) => percent(row.ratePercent, row.rateUnit ?? undefined) },
                    { header: "到期日", cell: (row) => date(row.maturityDate) },
                    {
                        header: "逾期天數",
                        cell: (row) => row.daysOverdue > 0 ? (_jsx("span", { className: "tabular font-medium text-rose-600", children: row.daysOverdue })) : ("—"),
                    },
                ] })), tab === "payments" && (_jsx(DataTable, { rows: data.payments, rowKey: (row) => row.id, empty: "\u5C1A\u7121\u9084\u6B3E\u7D00\u9304", columns: [
                    { header: "收款編號", cell: (row) => _jsx("span", { className: "tabular", children: row.paymentNumber }) },
                    { header: "日期", cell: (row) => dateTime(row.paidAt) },
                    { header: "金額", cell: (row) => _jsx(Money, { value: row.amount, className: "font-medium" }), className: "text-right" },
                    { header: "本金", cell: (row) => _jsx(Money, { value: row.allocation?.principal }), className: "text-right" },
                    { header: "利息", cell: (row) => _jsx(Money, { value: row.allocation?.interest }), className: "text-right" },
                    { header: "費用", cell: (row) => _jsx(Money, { value: row.allocation?.fee }), className: "text-right" },
                    { header: "方式", cell: (row) => row.method },
                    { header: "狀態", cell: (row) => _jsx(StatusBadge, { status: row.status }) },
                    {
                        header: "放款",
                        cell: (row) => (_jsx(Link, { to: `/loans/${row.loanId}`, className: "text-brand-600 hover:underline", children: "\u67E5\u770B" })),
                    },
                ] })), tab === "applications" && (_jsx(DataTable, { rows: data.applications, rowKey: (row) => row.id, empty: "\u5C1A\u7121\u7533\u8ACB\u7D00\u9304", columns: [
                    {
                        header: "申請編號",
                        cell: (row) => (_jsx(Link, { to: `/lending/applications/${row.id}`, className: "font-medium text-brand-600 hover:underline", children: row.applicationNumber })),
                    },
                    { header: "產品", cell: (row) => row.productName },
                    { header: "申請金額", cell: (row) => _jsx(Money, { value: row.requestedAmount }), className: "text-right" },
                    { header: "期數", cell: (row) => `${row.requestedTermMonths} 期` },
                    { header: "狀態", cell: (row) => _jsx(StatusBadge, { status: row.status, kind: "application" }) },
                    { header: "申請日", cell: (row) => date(row.createdAt) },
                ] })), tab === "risk" && (_jsxs("div", { className: "space-y-3", children: [data.riskHistory.length === 0 && (_jsx("div", { className: "card p-8 text-center text-sm text-slate-500", children: "\u5C1A\u7121\u98A8\u96AA\u8A55\u4F30\u7D00\u9304" })), data.riskHistory.map((assessment) => (_jsxs("div", { className: "card p-5", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(RiskGradeBadge, { grade: assessment.grade }), _jsxs("span", { className: "tabular text-lg font-semibold", children: [assessment.score, " \u5206"] }), _jsx("span", { className: "text-sm text-slate-500", children: assessment.decision })] }), _jsx("span", { className: "text-xs text-slate-500", children: dateTime(assessment.createdAt) })] }), _jsx("ul", { className: "mt-3 list-inside list-disc space-y-1 text-sm text-slate-600", children: assessment.reasons.map((reason, index) => (_jsx("li", { children: reason }, index))) })] }, assessment.id)))] })), tab === "collections" && (_jsx(DataTable, { rows: data.collectionCases, rowKey: (row) => row.id, empty: "\u5C1A\u7121\u50AC\u6536\u6848\u4EF6", columns: [
                    {
                        header: "案件編號",
                        cell: (row) => (_jsx(Link, { to: `/collections/${row.id}`, className: "font-medium text-brand-600 hover:underline", children: row.caseNumber })),
                    },
                    { header: "狀態", cell: (row) => _jsx(StatusBadge, { status: row.status, kind: "collection" }) },
                    { header: "優先度", cell: (row) => _jsx(StatusBadge, { status: row.priority, kind: "priority" }) },
                    { header: "逾期天數", cell: (row) => _jsx("span", { className: "tabular", children: row.daysOverdue }) },
                    { header: "欠款", cell: (row) => _jsx(Money, { value: row.outstandingAmount }), className: "text-right" },
                    { header: "催收次數", cell: (row) => `${row.activityCount} 次` },
                    { header: "下次追蹤", cell: (row) => date(row.nextActionAt) },
                ] }))] }));
}
