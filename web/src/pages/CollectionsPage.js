import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { date, money } from "../lib/format";
import { DataTable, ErrorBanner, KpiCard, Loading, Money, PageHeader, StatusBadge, } from "../components/ui";
const FILTERS = [
    { id: "", label: "全部" },
    { id: "OPEN", label: "待處理" },
    { id: "IN_PROGRESS", label: "催收中" },
    { id: "PROMISE_TO_PAY", label: "已承諾還款" },
    { id: "PAID", label: "已還款" },
    { id: "CLOSED", label: "已結案" },
];
export function CollectionsPage() {
    const [status, setStatus] = useState("");
    const { data: dashboard } = useQuery({
        queryKey: ["collections-dashboard"],
        queryFn: () => api("/api/collections/dashboard"),
    });
    const { data, isLoading, error } = useQuery({
        queryKey: ["collections", status],
        queryFn: () => api("/api/collections", { query: { status, take: 50 } }),
    });
    return (_jsxs("div", { children: [_jsx(PageHeader, { title: "\u50AC\u6536", subtitle: data ? `共 ${data.total} 件案件` : undefined }), dashboard && (_jsxs("div", { className: "mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5", children: [_jsx(KpiCard, { label: "\u50AC\u6536\u6848\u4EF6", value: String(dashboard.openCases) }), _jsx(KpiCard, { label: "\u903E\u671F\u91D1\u984D", value: money(dashboard.overdueAmount), tone: "danger" }), _jsx(KpiCard, { label: "\u9AD8\u98A8\u96AA\u6848\u4EF6", value: String(dashboard.highRiskCases), tone: "danger" }), _jsx(KpiCard, { label: "\u4ECA\u65E5\u5F85\u8FFD\u8E64", value: String(dashboard.todayFollowUps), tone: "warning" }), _jsx(KpiCard, { label: "\u9084\u6B3E\u627F\u8AFE", value: String(dashboard.pendingPromises) })] })), _jsx("div", { className: "mb-4 flex flex-wrap gap-2", children: FILTERS.map((filter) => (_jsx("button", { onClick: () => setStatus(filter.id), className: `rounded-full px-3 py-1.5 text-sm font-medium transition ${status === filter.id
                        ? "bg-brand-600 text-white"
                        : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`, children: filter.label }, filter.id))) }), _jsx(ErrorBanner, { error: error }), isLoading ? (_jsx(Loading, {})) : (_jsx(DataTable, { rows: data?.items ?? [], rowKey: (row) => row.id, empty: "\u6C92\u6709\u7B26\u5408\u689D\u4EF6\u7684\u50AC\u6536\u6848\u4EF6", columns: [
                    {
                        header: "案件編號",
                        cell: (row) => (_jsx(Link, { to: `/collections/${row.id}`, className: "font-medium text-brand-600 hover:underline", children: row.caseNumber })),
                    },
                    {
                        header: "客戶",
                        cell: (row) => (_jsxs("div", { children: [_jsx(Link, { to: `/customers/${row.customer.id}`, className: "hover:underline", children: row.customer.name }), _jsx("div", { className: "tabular text-xs text-slate-400", children: row.customer.phone })] })),
                    },
                    {
                        header: "放款",
                        cell: (row) => (_jsx(Link, { to: `/loans/${row.loan.id}`, className: "text-brand-600 hover:underline", children: row.loan.loanNumber })),
                    },
                    { header: "優先度", cell: (row) => _jsx(StatusBadge, { status: row.priority, kind: "priority" }) },
                    { header: "狀態", cell: (row) => _jsx(StatusBadge, { status: row.status, kind: "collection" }) },
                    {
                        header: "逾期天數",
                        cell: (row) => _jsx("span", { className: "tabular font-medium text-rose-600", children: row.daysOverdue }),
                    },
                    {
                        header: "欠款",
                        cell: (row) => _jsx(Money, { value: row.outstandingAmountCents / 100, className: "font-medium" }),
                        className: "text-right",
                    },
                    { header: "負責人", cell: (row) => row.assignedUser?.displayName ?? "未指派" },
                    { header: "下次追蹤", cell: (row) => date(row.nextActionAt) },
                ] }))] }));
}
