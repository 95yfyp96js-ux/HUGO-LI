import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, newIdempotencyKey } from "../lib/api";
import { date, money, percent, REPAYMENT_METHOD_LABELS } from "../lib/format";
import { DataTable, ErrorBanner, Loading, Money, PageHeader, StatusBadge } from "../components/ui";
import { useAuth } from "../lib/auth";
export function PendingDisbursementPage() {
    const { can } = useAuth();
    const queryClient = useQueryClient();
    const [confirming, setConfirming] = useState(null);
    const { data, isLoading, error } = useQuery({
        queryKey: ["loans", "pending-disbursement"],
        queryFn: () => api("/api/loans", {
            query: { pendingDisbursement: true, take: 100 },
        }),
    });
    return (_jsxs("div", { children: [_jsx(PageHeader, { title: "\u5F85\u64A5\u6B3E", subtitle: data ? `共 ${data.total} 筆待撥款` : undefined }), _jsx(ErrorBanner, { error: error }), isLoading ? (_jsx(Loading, {})) : (_jsx(DataTable, { rows: data?.items ?? [], rowKey: (row) => row.id, empty: "\u76EE\u524D\u6C92\u6709\u5F85\u64A5\u6B3E\u7684\u653E\u6B3E", columns: [
                    {
                        header: "放款編號",
                        cell: (row) => (_jsx(Link, { to: `/loans/${row.id}`, className: "font-medium text-brand-600 hover:underline", children: row.loanNumber })),
                    },
                    {
                        header: "客戶",
                        cell: (row) => (_jsx(Link, { to: `/customers/${row.customer.id}`, className: "hover:underline", children: row.customer.name })),
                    },
                    { header: "狀態", cell: (row) => _jsx(StatusBadge, { status: row.status }) },
                    {
                        header: "核准金額",
                        cell: (row) => _jsx(Money, { value: row.principalCents / 100, className: "font-medium" }),
                        className: "text-right",
                    },
                    { header: "利率", cell: (row) => percent(row.snapshot?.ratePercent, row.snapshot?.rateUnit) },
                    { header: "期數", cell: (row) => (row.snapshot ? `${row.snapshot.termMonths} 期` : "—") },
                    { header: "到期日", cell: (row) => date(row.maturityDate) },
                    {
                        header: "操作",
                        cell: (row) => can("LOAN_DISBURSE") ? (_jsx("button", { className: "btn-primary py-1 text-xs", onClick: () => setConfirming(row.id), children: "\u64A5\u6B3E" })) : (_jsx("span", { className: "text-xs text-slate-400", children: "\u7121\u6B0A\u9650" })),
                    },
                ] })), confirming && (_jsx(DisbursementDialog, { loanId: confirming, onClose: () => setConfirming(null), onDone: () => {
                    setConfirming(null);
                    queryClient.invalidateQueries({ queryKey: ["loans"] });
                    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
                } }))] }));
}
/**
 * Disbursement confirmation (§38): shows the exact terms about to be
 * committed before money moves, and sends a fresh Idempotency-Key so a
 * double-click cannot pay twice.
 */
function DisbursementDialog({ loanId, onClose, onDone, }) {
    const [idempotencyKey] = useState(newIdempotencyKey);
    const [method, setMethod] = useState("BANK_TRANSFER");
    const { data: loan, isLoading } = useQuery({
        queryKey: ["loan", loanId],
        queryFn: () => api(`/api/loans/${loanId}`),
    });
    const mutation = useMutation({
        mutationFn: () => api(`/api/loans/${loanId}/disburse`, { method: "POST", body: { method }, idempotencyKey }),
        onSuccess: onDone,
    });
    const firstInstallment = loan?.scheduleLines[0];
    const totalPayable = loan?.scheduleLines.reduce((sum, line) => sum + line.totalDueCents, 0) ?? 0;
    return (_jsx("div", { className: "fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4", children: _jsxs("div", { className: "w-full max-w-lg rounded-t-2xl bg-white p-6 sm:rounded-2xl", children: [_jsx("h2", { className: "text-lg font-semibold", children: "\u64A5\u6B3E\u78BA\u8A8D" }), _jsx("p", { className: "mt-1 text-sm text-slate-500", children: "\u8ACB\u78BA\u8A8D\u4EE5\u4E0B\u653E\u6B3E\u689D\u4EF6\uFF0C\u64A5\u6B3E\u5F8C\u4E0D\u53EF\u64A4\u92B7\u3002" }), isLoading || !loan ? (_jsx(Loading, {})) : (_jsxs(_Fragment, { children: [_jsxs("dl", { className: "mt-4 space-y-2 rounded-lg bg-slate-50 p-4 text-sm", children: [_jsx(Row, { label: "\u5BA2\u6236", value: `${loan.customer.name}（${loan.customer.customerNumber}）` }), _jsx(Row, { label: "\u653E\u6B3E\u7DE8\u865F", value: loan.loanNumber }), _jsx(Row, { label: "\u64A5\u6B3E\u91D1\u984D", value: money(loan.principalCents / 100), strong: true }), _jsx(Row, { label: "\u653E\u6B3E\u5229\u7387", value: percent(loan.snapshot?.ratePercent, loan.snapshot?.rateUnit) }), _jsx(Row, { label: "\u671F\u6578", value: `${loan.snapshot?.termMonths ?? "—"} 期` }), _jsx(Row, { label: "\u9084\u6B3E\u65B9\u5F0F", value: REPAYMENT_METHOD_LABELS[loan.snapshot?.repaymentMethod ?? ""] ?? "—" }), _jsx(Row, { label: "\u7B2C\u4E00\u671F\u61C9\u7E73\u65E5", value: date(firstInstallment?.dueDate) }), _jsx(Row, { label: "\u7E3D\u61C9\u9084", value: money(totalPayable / 100), strong: true })] }), _jsxs("div", { className: "mt-4", children: [_jsx("label", { className: "label", htmlFor: "pend-f1", children: "\u64A5\u6B3E\u65B9\u5F0F" }), _jsxs("select", { id: "pend-f1", className: "input", value: method, onChange: (e) => setMethod(e.target.value), children: [_jsx("option", { value: "BANK_TRANSFER", children: "\u9280\u884C\u8F49\u5E33" }), _jsx("option", { value: "CASH", children: "\u73FE\u91D1" }), _jsx("option", { value: "CHECK", children: "\u652F\u7968" })] })] }), _jsx(ErrorBanner, { error: mutation.error }), _jsxs("div", { className: "mt-5 flex justify-end gap-2", children: [_jsx("button", { className: "btn-secondary", onClick: onClose, disabled: mutation.isPending, children: "\u53D6\u6D88" }), _jsx("button", { className: "btn-primary", onClick: () => mutation.mutate(), disabled: mutation.isPending, children: mutation.isPending ? "撥款中…" : "確認撥款" })] })] }))] }) }));
}
function Row({ label, value, strong }) {
    return (_jsxs("div", { className: "flex justify-between", children: [_jsx("dt", { className: "text-slate-500", children: label }), _jsx("dd", { className: `tabular ${strong ? "font-semibold text-slate-900" : "text-slate-700"}`, children: value })] }));
}
