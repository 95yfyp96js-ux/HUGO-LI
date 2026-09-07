import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { date } from "../lib/format";
import { DataTable, ErrorBanner, Loading, Money, PageHeader, RiskGradeBadge, StatusBadge, } from "../components/ui";
import { useAuth } from "../lib/auth";
const FILTERS = [
    { id: "", label: "全部" },
    { id: "DRAFT", label: "草稿" },
    { id: "UNDER_REVIEW", label: "審核中" },
    { id: "RISK_REVIEW", label: "風控複審" },
    { id: "APPROVED", label: "已核准" },
    { id: "REJECTED", label: "已婉拒" },
];
export function ApplicationsPage() {
    const { can } = useAuth();
    const [status, setStatus] = useState("");
    const { data, isLoading, error } = useQuery({
        queryKey: ["applications", status],
        queryFn: () => api("/api/lending/applications", {
            query: { status, take: 50 },
        }),
    });
    return (_jsxs("div", { children: [_jsx(PageHeader, { title: "\u653E\u6B3E\u7533\u8ACB", subtitle: data ? `共 ${data.total} 件申請` : undefined, actions: can("APPLICATION_CREATE") && (_jsx(Link, { to: "/lending/applications/new", className: "btn-primary", children: "\u65B0\u589E\u7533\u8ACB" })) }), _jsx("div", { className: "mb-4 flex flex-wrap gap-2", children: FILTERS.map((filter) => (_jsx("button", { onClick: () => setStatus(filter.id), className: `rounded-full px-3 py-1.5 text-sm font-medium transition ${status === filter.id
                        ? "bg-brand-600 text-white"
                        : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`, children: filter.label }, filter.id))) }), _jsx(ErrorBanner, { error: error }), isLoading ? (_jsx(Loading, {})) : (_jsx(DataTable, { rows: data?.items ?? [], rowKey: (row) => row.id, empty: "\u6C92\u6709\u7B26\u5408\u689D\u4EF6\u7684\u7533\u8ACB", columns: [
                    {
                        header: "申請編號",
                        cell: (row) => (_jsx(Link, { to: `/lending/applications/${row.id}`, className: "font-medium text-brand-600 hover:underline", children: row.applicationNumber })),
                    },
                    {
                        header: "客戶",
                        cell: (row) => (_jsx(Link, { to: `/customers/${row.customer.id}`, className: "hover:underline", children: row.customer.name })),
                    },
                    { header: "產品", cell: (row) => row.requestedProduct.name },
                    {
                        header: "申請金額",
                        cell: (row) => _jsx(Money, { value: row.requestedAmountCents / 100 }),
                        className: "text-right",
                    },
                    { header: "期數", cell: (row) => `${row.requestedTermMonths} 期` },
                    { header: "風險", cell: (row) => _jsx(RiskGradeBadge, { grade: row.riskAssessments[0]?.grade ?? null }) },
                    {
                        header: "建議額度",
                        cell: (row) => row.loanOffers[0] ? _jsx(Money, { value: row.loanOffers[0].approvedAmountCents / 100 }) : "—",
                        className: "text-right",
                    },
                    { header: "狀態", cell: (row) => _jsx(StatusBadge, { status: row.status, kind: "application" }) },
                    { header: "申請日", cell: (row) => date(row.createdAt) },
                ] }))] }));
}
