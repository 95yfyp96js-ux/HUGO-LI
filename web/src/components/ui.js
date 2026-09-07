import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from "react-router-dom";
import { APPLICATION_STATUS_LABELS, COLLECTION_STATUS_LABELS, LOAN_STATUS_LABELS, PRIORITY_LABELS, money, } from "../lib/format";
export function PageHeader({ title, subtitle, actions, }) {
    return (_jsxs("div", { className: "mb-6 flex flex-wrap items-start justify-between gap-3", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-semibold text-slate-900", children: title }), subtitle && _jsx("p", { className: "mt-1 text-sm text-slate-500", children: subtitle })] }), actions && _jsx("div", { className: "flex flex-wrap gap-2", children: actions })] }));
}
const STATUS_TONES = {
    ACTIVE: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    APPROVED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    PAID_OFF: "bg-slate-100 text-slate-600 ring-slate-200",
    PAID: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    CLOSED: "bg-slate-100 text-slate-600 ring-slate-200",
    OVERDUE: "bg-rose-50 text-rose-700 ring-rose-200",
    DEFAULTED: "bg-rose-100 text-rose-800 ring-rose-300",
    ESCALATED: "bg-rose-50 text-rose-700 ring-rose-200",
    DUE: "bg-amber-50 text-amber-700 ring-amber-200",
    DUE_SOON: "bg-amber-50 text-amber-700 ring-amber-200",
    READY_FOR_DISBURSEMENT: "bg-brand-50 text-brand-700 ring-brand-100",
    DISBURSED: "bg-brand-50 text-brand-700 ring-brand-100",
    UNDER_REVIEW: "bg-brand-50 text-brand-700 ring-brand-100",
    RISK_REVIEW: "bg-amber-50 text-amber-700 ring-amber-200",
    SUBMITTED: "bg-brand-50 text-brand-700 ring-brand-100",
    IN_PROGRESS: "bg-brand-50 text-brand-700 ring-brand-100",
    PROMISE_TO_PAY: "bg-violet-50 text-violet-700 ring-violet-200",
    REJECTED: "bg-rose-50 text-rose-700 ring-rose-200",
    CANCELLED: "bg-slate-100 text-slate-500 ring-slate-200",
    RESTRUCTURED: "bg-violet-50 text-violet-700 ring-violet-200",
    DRAFT: "bg-slate-100 text-slate-600 ring-slate-200",
    OPEN: "bg-amber-50 text-amber-700 ring-amber-200",
    CRITICAL: "bg-rose-100 text-rose-800 ring-rose-300",
    HIGH: "bg-rose-50 text-rose-700 ring-rose-200",
    MEDIUM: "bg-amber-50 text-amber-700 ring-amber-200",
    LOW: "bg-slate-100 text-slate-600 ring-slate-200",
};
export function StatusBadge({ status, kind }) {
    const labels = kind === "application"
        ? APPLICATION_STATUS_LABELS
        : kind === "collection"
            ? COLLECTION_STATUS_LABELS
            : kind === "priority"
                ? PRIORITY_LABELS
                : LOAN_STATUS_LABELS;
    return (_jsx("span", { className: `inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${STATUS_TONES[status] ?? "bg-slate-100 text-slate-600 ring-slate-200"}`, children: labels[status] ?? status }));
}
export function RiskGradeBadge({ grade }) {
    if (!grade)
        return _jsx("span", { className: "text-slate-400", children: "\u2014" });
    const tone = {
        A: "bg-emerald-50 text-emerald-700 ring-emerald-200",
        B: "bg-teal-50 text-teal-700 ring-teal-200",
        C: "bg-amber-50 text-amber-700 ring-amber-200",
        D: "bg-orange-50 text-orange-700 ring-orange-200",
        E: "bg-rose-50 text-rose-700 ring-rose-200",
    };
    return (_jsx("span", { className: `inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ring-1 ring-inset ${tone[grade] ?? "bg-slate-100 text-slate-600 ring-slate-200"}`, children: grade }));
}
export function KpiCard({ label, value, sub, to, tone = "default", }) {
    const tones = {
        default: "text-slate-900",
        danger: "text-rose-600",
        success: "text-emerald-600",
        warning: "text-amber-600",
    };
    const content = (_jsxs("div", { className: "card h-full p-4 transition hover:border-brand-200", children: [_jsx("div", { className: "text-xs font-medium uppercase tracking-wide text-slate-500", children: label }), _jsx("div", { className: `tabular mt-2 text-2xl font-semibold ${tones[tone]}`, children: value }), sub && _jsx("div", { className: "mt-1 text-xs text-slate-500", children: sub })] }));
    // Every KPI drills down to the records behind it (§33).
    return to ? (_jsx(Link, { to: to, className: "block", children: content })) : (content);
}
export function DataTable({ columns, rows, empty = "沒有資料", rowKey, }) {
    if (rows.length === 0) {
        return _jsx("div", { className: "card p-8 text-center text-sm text-slate-500", children: empty });
    }
    return (_jsx("div", { className: "card overflow-hidden", children: _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "min-w-full divide-y divide-slate-200", children: [_jsx("thead", { className: "bg-slate-50", children: _jsx("tr", { children: columns.map((column) => (_jsx("th", { className: `th ${column.className ?? ""}`, children: column.header }, column.header))) }) }), _jsx("tbody", { className: "divide-y divide-slate-100 bg-white", children: rows.map((row) => (_jsx("tr", { className: "hover:bg-slate-50", children: columns.map((column) => (_jsx("td", { className: `td ${column.className ?? ""}`, children: column.cell(row) }, column.header))) }, rowKey(row)))) })] }) }) }));
}
export function Money({ value, className = "" }) {
    return _jsx("span", { className: `tabular ${className}`, children: money(value) });
}
export function Field({ label, children }) {
    return (_jsxs("div", { children: [_jsx("dt", { className: "text-xs font-medium uppercase tracking-wide text-slate-500", children: label }), _jsx("dd", { className: "mt-1 text-sm font-medium text-slate-900", children: children })] }));
}
export function Loading({ label = "載入中..." }) {
    return _jsx("div", { className: "p-8 text-center text-sm text-slate-500", children: label });
}
export function ErrorBanner({ error }) {
    if (!error)
        return null;
    const message = error instanceof Error ? error.message : "發生未預期的錯誤";
    const code = error?.code;
    return (_jsxs("div", { className: "mb-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800", children: [_jsx("div", { className: "font-medium", children: message }), code && _jsx("div", { className: "mt-1 font-mono text-xs text-rose-600", children: code })] }));
}
export function Tabs({ tabs, active, onChange, }) {
    return (_jsx("div", { className: "mb-4 overflow-x-auto border-b border-slate-200", children: _jsx("nav", { className: "flex gap-1", children: tabs.map((tab) => (_jsx("button", { onClick: () => onChange(tab.id), className: `whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${active === tab.id
                    ? "border-brand-600 text-brand-700"
                    : "border-transparent text-slate-500 hover:text-slate-800"}`, children: tab.label }, tab.id))) }) }));
}
