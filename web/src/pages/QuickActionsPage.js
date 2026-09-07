import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { money } from "../lib/format";
import { Loading, StatusBadge } from "../components/ui";
import { useAuth } from "../lib/auth";
/**
 * Mobile-first operations screen (§44). Large tap targets, a single search
 * box that matches loans or customers, and the two workflows that matter in
 * the field: take a payment, start a loan.
 */
export function QuickActionsPage() {
    const { can } = useAuth();
    const navigate = useNavigate();
    const [query, setQuery] = useState("");
    const { data: summary } = useQuery({
        queryKey: ["portfolio-summary"],
        queryFn: () => api("/api/portfolio/summary"),
    });
    const { data: loans, isFetching } = useQuery({
        queryKey: ["quick-search", query],
        queryFn: () => api("/api/loans", { query: { take: 100 } }),
        enabled: query.length > 0,
        select: (result) => ({
            items: result.items
                .filter((loan) => loan.loanNumber.toLowerCase().includes(query.toLowerCase()) ||
                loan.customer.name.includes(query) ||
                loan.customer.customerNumber.toLowerCase().includes(query.toLowerCase()))
                .slice(0, 10),
        }),
    });
    const actions = [
        { to: "/payments/new", label: "快速收款", icon: "💵", tone: "bg-emerald-500", permission: "PAYMENT_CREATE" },
        { to: "/loans/new", label: "新增放款", icon: "➕", tone: "bg-brand-600", permission: "LOAN_CREATE" },
        { to: "/customers/new", label: "新增客戶", icon: "👤", tone: "bg-violet-500", permission: "CUSTOMER_CREATE" },
        { to: "/loans/overdue", label: "逾期催收", icon: "⚠️", tone: "bg-rose-500", permission: "LOAN_READ" },
    ].filter((action) => can(action.permission));
    return (_jsxs("div", { className: "mx-auto max-w-2xl", children: [_jsx("h1", { className: "mb-4 text-xl font-semibold", children: "\u5FEB\u901F\u4F5C\u696D" }), summary && (_jsxs("div", { className: "mb-5 grid grid-cols-2 gap-3", children: [_jsxs("div", { className: "card p-4", children: [_jsx("div", { className: "text-xs text-slate-500", children: "\u4ECA\u65E5\u653E\u6B3E" }), _jsx("div", { className: "tabular mt-1 text-lg font-semibold", children: money(summary.todayDisbursement) })] }), _jsxs("div", { className: "card p-4", children: [_jsx("div", { className: "text-xs text-slate-500", children: "\u4ECA\u65E5\u6536\u6B3E" }), _jsx("div", { className: "tabular mt-1 text-lg font-semibold text-emerald-600", children: money(summary.todayCollection) })] }), _jsxs(Link, { to: "/loans?status=DUE", className: "card p-4", children: [_jsx("div", { className: "text-xs text-slate-500", children: "\u4ECA\u65E5\u5230\u671F" }), _jsxs("div", { className: "tabular mt-1 text-lg font-semibold text-amber-600", children: [summary.dueTodayCount, " \u4EF6"] })] }), _jsxs(Link, { to: "/loans/overdue", className: "card p-4", children: [_jsx("div", { className: "text-xs text-slate-500", children: "\u903E\u671F\u4EF6\u6578" }), _jsxs("div", { className: "tabular mt-1 text-lg font-semibold text-rose-600", children: [summary.overdueLoanCount, " \u4EF6"] })] })] })), _jsx("div", { className: "mb-5 grid grid-cols-2 gap-3", children: actions.map((action) => (_jsxs(Link, { to: action.to, className: `touch-target flex flex-col items-center justify-center gap-1 rounded-xl ${action.tone} p-4 text-white shadow-sm active:scale-95`, children: [_jsx("span", { className: "text-2xl", children: action.icon }), _jsx("span", { className: "text-sm font-medium", children: action.label })] }, action.to))) }), _jsxs("div", { className: "card p-4", children: [_jsx("label", { className: "label", htmlFor: "quic-f1", children: "\u5FEB\u901F\u67E5\u8A62" }), _jsx("input", { id: "quic-f1", className: "input text-base", placeholder: "\u8F38\u5165\u653E\u6B3E\u7DE8\u865F\u6216\u5BA2\u6236\u59D3\u540D", value: query, onChange: (e) => setQuery(e.target.value) }), isFetching && _jsx(Loading, { label: "\u641C\u5C0B\u4E2D\u2026" }), loans && loans.items.length > 0 && (_jsx("ul", { className: "mt-3 divide-y divide-slate-100", children: loans.items.map((loan) => (_jsx("li", { children: _jsxs("button", { className: "touch-target flex w-full items-center justify-between gap-3 text-left", onClick: () => navigate(`/loans/${loan.id}`), children: [_jsxs("div", { className: "min-w-0", children: [_jsx("div", { className: "truncate font-medium", children: loan.customer.name }), _jsx("div", { className: "tabular text-xs text-slate-500", children: loan.loanNumber })] }), _jsxs("div", { className: "shrink-0 text-right", children: [_jsx("div", { className: "tabular text-sm font-semibold", children: money(loan.totalOutstanding) }), _jsx(StatusBadge, { status: loan.status })] })] }) }, loan.id))) })), query.length > 0 && loans?.items.length === 0 && !isFetching && (_jsx("p", { className: "mt-3 text-sm text-slate-500", children: "\u67E5\u7121\u7B26\u5408\u7684\u653E\u6B3E" }))] })] }));
}
