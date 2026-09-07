import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { date, percent } from "../lib/format";
import { DataTable, ErrorBanner, Loading, Money, PageHeader, RiskGradeBadge, StatusBadge, } from "../components/ui";
import { useAuth } from "../lib/auth";
const FILTERS = [
    { id: "", label: "全部" },
    { id: "READY_FOR_DISBURSEMENT", label: "待撥款" },
    { id: "ACTIVE", label: "放款中" },
    { id: "DUE", label: "今日到期" },
    { id: "OVERDUE", label: "逾期" },
    { id: "RESTRUCTURED", label: "已重整" },
    { id: "PAID_OFF", label: "已結清" },
];
export function LoansPage() {
    const { can } = useAuth();
    const [searchParams] = useSearchParams();
    const [status, setStatus] = useState(searchParams.get("status") ?? "");
    const { data, isLoading, error } = useQuery({
        queryKey: ["loans", status],
        queryFn: () => api("/api/loans", { query: { status, take: 50 } }),
    });
    return (_jsxs("div", { children: [_jsx(PageHeader, { title: "\u653E\u6B3E\u5E33\u6236", subtitle: data ? `共 ${data.total} 筆放款` : undefined, actions: can("LOAN_CREATE") && (_jsx(Link, { to: "/loans/new", className: "btn-primary", children: "\u65B0\u589E\u653E\u6B3E" })) }), _jsx("div", { className: "mb-4 flex flex-wrap gap-2", children: FILTERS.map((filter) => (_jsx("button", { onClick: () => setStatus(filter.id), className: `rounded-full px-3 py-1.5 text-sm font-medium transition ${status === filter.id
                        ? "bg-brand-600 text-white"
                        : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`, children: filter.label }, filter.id))) }), _jsx(ErrorBanner, { error: error }), isLoading ? _jsx(Loading, {}) : _jsx(LoanTable, { rows: data?.items ?? [] })] }));
}
export function LoanTable({ rows, empty }) {
    return (_jsx(DataTable, { rows: rows, rowKey: (row) => row.id, empty: empty ?? "沒有符合條件的放款", columns: [
            {
                header: "放款編號",
                cell: (row) => (_jsx(Link, { to: `/loans/${row.id}`, className: "font-medium text-brand-600 hover:underline", children: row.loanNumber })),
            },
            {
                header: "客戶",
                cell: (row) => (_jsxs(Link, { to: `/customers/${row.customer.id}`, className: "hover:underline", children: [row.customer.name, _jsx("span", { className: "ml-1 text-xs text-slate-400", children: row.customer.customerNumber })] })),
            },
            { header: "狀態", cell: (row) => _jsx(StatusBadge, { status: row.status }) },
            { header: "風險", cell: (row) => _jsx(RiskGradeBadge, { grade: row.riskGrade }) },
            {
                header: "放款金額",
                cell: (row) => _jsx(Money, { value: row.principalCents / 100 }),
                className: "text-right",
            },
            {
                header: "剩餘本金",
                cell: (row) => _jsx(Money, { value: row.outstandingPrincipalCents / 100 }),
                className: "text-right",
            },
            {
                header: "總欠款",
                cell: (row) => _jsx(Money, { value: row.totalOutstanding, className: "font-medium" }),
                className: "text-right",
            },
            {
                header: "利率",
                cell: (row) => percent(row.snapshot?.ratePercent, row.snapshot?.rateUnit),
            },
            { header: "到期日", cell: (row) => date(row.maturityDate) },
            {
                header: "逾期",
                cell: (row) => row.daysOverdue > 0 ? (_jsxs("span", { className: "tabular font-medium text-rose-600", children: [row.daysOverdue, " \u5929"] })) : (_jsx("span", { className: "text-slate-400", children: "\u2014" })),
            },
        ] }));
}
