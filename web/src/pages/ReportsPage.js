import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { money } from "../lib/format";
import { ErrorBanner, KpiCard, Loading, PageHeader, Tabs } from "../components/ui";
const TABS = [
    { id: "portfolio", label: "資產組合" },
    { id: "trend", label: "放款／收款趨勢" },
    { id: "risk", label: "風險分布" },
];
export function ReportsPage() {
    const [tab, setTab] = useState("portfolio");
    const [days, setDays] = useState(30);
    const { data: summary, isLoading, error } = useQuery({
        queryKey: ["portfolio-summary"],
        queryFn: () => api("/api/portfolio/summary"),
    });
    const { data: trend } = useQuery({
        queryKey: ["portfolio-trend", days],
        queryFn: () => api("/api/portfolio/trend", { query: { days } }),
        enabled: tab === "trend",
    });
    const { data: byGrade } = useQuery({
        queryKey: ["portfolio-by-risk-grade"],
        queryFn: () => api("/api/portfolio/by-risk-grade"),
        enabled: tab === "risk",
    });
    /** CSV export runs client-side over data the API already returned. */
    function exportCsv(filename, rows) {
        if (rows.length === 0)
            return;
        const headers = Object.keys(rows[0]);
        const csv = [
            headers.join(","),
            ...rows.map((row) => headers.map((header) => `"${String(row[header] ?? "")}"`).join(",")),
        ].join("\n");
        // BOM so Excel opens UTF-8 Chinese correctly.
        const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }
    if (isLoading)
        return _jsx(Loading, {});
    if (error)
        return _jsx(ErrorBanner, { error: error });
    if (!summary)
        return null;
    return (_jsxs("div", { children: [_jsx(PageHeader, { title: "\u5831\u8868", subtitle: "\u6240\u6709\u6578\u5B57\u7531\u5F8C\u7AEF\u4F9D\u5BE6\u969B\u7D00\u9304\u8A08\u7B97" }), _jsx(Tabs, { tabs: TABS, active: tab, onChange: setTab }), tab === "portfolio" && (_jsxs(_Fragment, { children: [_jsx("div", { className: "mb-4 flex justify-end", children: _jsx("button", { className: "btn-secondary text-xs", onClick: () => exportCsv("portfolio-report.csv", [
                                { 項目: "放款本金餘額", 金額: summary.outstandingPrincipal },
                                { 項目: "應收利息", 金額: summary.outstandingInterest },
                                { 項目: "總放款餘額", 金額: summary.totalOutstanding },
                                { 項目: "逾期本金", 金額: summary.overduePrincipal },
                                { 項目: "累計撥款", 金額: summary.totalDisbursed },
                                { 項目: "累計收款", 金額: summary.totalCollected },
                                { 項目: "PAR7", 金額: summary.par.par7 },
                                { 項目: "PAR30", 金額: summary.par.par30 },
                                { 項目: "PAR60", 金額: summary.par.par60 },
                                { 項目: "PAR90", 金額: summary.par.par90 },
                            ]), children: "\u532F\u51FA CSV" }) }), _jsxs("div", { className: "mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4", children: [_jsx(KpiCard, { label: "\u653E\u6B3E\u672C\u91D1\u9918\u984D", value: money(summary.outstandingPrincipal) }), _jsx(KpiCard, { label: "\u61C9\u6536\u5229\u606F", value: money(summary.outstandingInterest) }), _jsx(KpiCard, { label: "\u7D2F\u8A08\u64A5\u6B3E", value: money(summary.totalDisbursed) }), _jsx(KpiCard, { label: "\u7D2F\u8A08\u6536\u6B3E", value: money(summary.totalCollected), tone: "success" }), _jsx(KpiCard, { label: "\u6D3B\u8E8D\u653E\u6B3E", value: `${summary.activeLoanCount} 件` }), _jsx(KpiCard, { label: "\u5DF2\u7D50\u6E05", value: `${summary.paidOffLoanCount} 件` }), _jsx(KpiCard, { label: "\u903E\u671F\u4EF6\u6578", value: `${summary.overdueLoanCount} 件`, tone: "danger" }), _jsx(KpiCard, { label: "\u56DE\u6536\u7387", value: `${summary.collectionRate}%` })] }), _jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-4 text-sm font-semibold text-slate-700", children: "\u8CC7\u7522\u54C1\u8CEA" }), _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-slate-200 text-xs uppercase text-slate-500", children: [_jsx("th", { className: "py-2 text-left", children: "\u6307\u6A19" }), _jsx("th", { className: "py-2 text-right", children: "\u9918\u984D" }), _jsx("th", { className: "py-2 text-right", children: "\u4F54\u6BD4" })] }) }), _jsxs("tbody", { className: "divide-y divide-slate-100", children: [["par7", "par30", "par60", "par90"].map((key) => (_jsxs("tr", { children: [_jsx("td", { className: "py-2", children: key.toUpperCase() }), _jsx("td", { className: "tabular py-2 text-right", children: money(summary.par[key]) }), _jsxs("td", { className: "tabular py-2 text-right", children: [summary.par[`${key}Ratio`], "%"] })] }, key))), _jsxs("tr", { children: [_jsx("td", { className: "py-2", children: "\u5E73\u5747\u653E\u6B3E\u91D1\u984D" }), _jsx("td", { className: "tabular py-2 text-right", children: money(summary.averageLoanSize) }), _jsx("td", { className: "py-2" })] }), _jsxs("tr", { children: [_jsx("td", { className: "py-2", children: "\u5E73\u5747\u903E\u671F\u5929\u6578" }), _jsxs("td", { className: "tabular py-2 text-right", children: [summary.averageDaysLate, " \u5929"] }), _jsx("td", { className: "py-2" })] })] })] })] })] })), tab === "trend" && (_jsxs("div", { className: "card p-5", children: [_jsxs("div", { className: "mb-4 flex items-center justify-between", children: [_jsx("h2", { className: "text-sm font-semibold text-slate-700", children: "\u653E\u6B3E\u8207\u6536\u6B3E\u8DA8\u52E2" }), _jsxs("div", { className: "flex gap-2", children: [[7, 30, 90].map((option) => (_jsxs("button", { onClick: () => setDays(option), className: `rounded-full px-3 py-1 text-xs font-medium ${days === option ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`, children: [option, " \u5929"] }, option))), _jsx("button", { className: "btn-secondary py-1 text-xs", onClick: () => exportCsv("trend-report.csv", (trend?.items ?? [])), children: "\u532F\u51FA CSV" })] })] }), !trend ? (_jsx(Loading, {})) : (_jsx(TrendChart, { points: trend.items }))] })), tab === "risk" && (_jsxs("div", { className: "card p-5", children: [_jsxs("div", { className: "mb-4 flex items-center justify-between", children: [_jsx("h2", { className: "text-sm font-semibold text-slate-700", children: "\u98A8\u96AA\u7B49\u7D1A\u5206\u5E03" }), _jsx("button", { className: "btn-secondary py-1 text-xs", onClick: () => exportCsv("risk-report.csv", (byGrade?.items ?? [])), children: "\u532F\u51FA CSV" })] }), !byGrade ? (_jsx(Loading, {})) : (_jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-slate-200 text-xs uppercase text-slate-500", children: [_jsx("th", { className: "py-2 text-left", children: "\u98A8\u96AA\u7B49\u7D1A" }), _jsx("th", { className: "py-2 text-right", children: "\u4EF6\u6578" }), _jsx("th", { className: "py-2 text-right", children: "\u653E\u6B3E\u9918\u984D" })] }) }), _jsx("tbody", { className: "divide-y divide-slate-100", children: byGrade.items.map((bucket) => (_jsxs("tr", { children: [_jsx("td", { className: "py-2 font-medium", children: bucket.grade }), _jsx("td", { className: "tabular py-2 text-right", children: bucket.loanCount }), _jsx("td", { className: "tabular py-2 text-right", children: money(bucket.outstanding) })] }, bucket.grade))) })] }))] }))] }));
}
/** Minimal inline bar chart — no charting dependency for two series. */
function TrendChart({ points }) {
    const max = Math.max(1, ...points.map((p) => Math.max(Number(p.disbursed), Number(p.collected))));
    return (_jsxs("div", { children: [_jsxs("div", { className: "mb-3 flex gap-4 text-xs", children: [_jsxs("span", { className: "flex items-center gap-1.5", children: [_jsx("span", { className: "h-2 w-2 rounded-sm bg-brand-500" }), " \u653E\u6B3E"] }), _jsxs("span", { className: "flex items-center gap-1.5", children: [_jsx("span", { className: "h-2 w-2 rounded-sm bg-emerald-500" }), " \u6536\u6B3E"] })] }), _jsx("div", { className: "flex h-48 items-end gap-0.5 overflow-x-auto", children: points.map((point) => (_jsxs("div", { className: "flex min-w-[6px] flex-1 flex-col justify-end gap-0.5", title: point.date, children: [_jsx("div", { className: "w-full rounded-t-sm bg-brand-500", style: { height: `${(Number(point.disbursed) / max) * 100}%` } }), _jsx("div", { className: "w-full rounded-t-sm bg-emerald-500", style: { height: `${(Number(point.collected) / max) * 100}%` } })] }, point.date))) }), _jsxs("div", { className: "mt-2 flex justify-between text-xs text-slate-400", children: [_jsx("span", { children: points[0]?.date }), _jsx("span", { children: points[points.length - 1]?.date })] })] }));
}
