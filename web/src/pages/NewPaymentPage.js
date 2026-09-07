import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, newIdempotencyKey } from "../lib/api";
import { money } from "../lib/format";
import { ErrorBanner, Loading, PageHeader, StatusBadge } from "../components/ui";
/**
 * Quick payment (§39). The allocation preview comes from the server's
 * AllocationEngine — the UI never splits a payment itself.
 */
export function NewPaymentPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [loanId, setLoanId] = useState(searchParams.get("loanId") ?? "");
    const [query, setQuery] = useState("");
    const [amount, setAmount] = useState("");
    const [method, setMethod] = useState("CASH");
    const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
    const { data: loans } = useQuery({
        queryKey: ["loans", "search", query],
        queryFn: () => api("/api/loans", { query: { take: 50 } }).then((result) => ({
            items: result.items.filter((loan) => ["ACTIVE", "DUE_SOON", "DUE", "OVERDUE", "DEFAULTED"].includes(loan.status) &&
                (query === "" ||
                    loan.loanNumber.toLowerCase().includes(query.toLowerCase()) ||
                    loan.customer.name.includes(query) ||
                    loan.customer.customerNumber.toLowerCase().includes(query.toLowerCase()))),
        })),
    });
    const selectedLoan = loans?.items.find((loan) => loan.id === loanId);
    const { data: preview, isFetching: previewLoading } = useQuery({
        queryKey: ["payment-preview", loanId, amount],
        queryFn: () => api("/api/payments/preview", { method: "POST", body: { loanId, amount } }),
        enabled: Boolean(loanId) && Number(amount) > 0,
    });
    const mutation = useMutation({
        mutationFn: () => api("/api/payments", {
            method: "POST",
            idempotencyKey,
            body: { loanId, amount, method },
        }),
        onSuccess: (result) => navigate(`/loans/${result.payment.loanId}`),
    });
    // A new key per loan/amount combination, so retrying a failed submit is
    // safe but a genuinely new payment is never blocked.
    useEffect(() => {
        setIdempotencyKey(newIdempotencyKey());
    }, [loanId]);
    return (_jsxs("div", { className: "mx-auto max-w-2xl", children: [_jsx(PageHeader, { title: "\u5FEB\u901F\u6536\u6B3E", subtitle: "\u5206\u914D\u65B9\u5F0F\u7531\u5F8C\u7AEF Allocation Engine \u8A08\u7B97\uFF1A\u5229\u606F \u2192 \u8CBB\u7528 \u2192 \u672C\u91D1" }), _jsxs("div", { className: "card space-y-5 p-5", children: [_jsx(ErrorBanner, { error: mutation.error }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "newp-f1", children: "\u9078\u64C7\u653E\u6B3E *" }), selectedLoan ? (_jsxs("div", { className: "flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 p-3", children: [_jsxs("div", { children: [_jsx("div", { className: "font-medium text-brand-900", children: selectedLoan.loanNumber }), _jsxs("div", { className: "text-xs text-brand-700", children: [selectedLoan.customer.name, "\uFF08", selectedLoan.customer.customerNumber, "\uFF09"] })] }), _jsxs("div", { className: "text-right", children: [_jsx(StatusBadge, { status: selectedLoan.status }), _jsx("div", { className: "tabular mt-1 text-sm font-semibold", children: money(selectedLoan.totalOutstanding) })] })] })) : (_jsxs(_Fragment, { children: [_jsx("input", { id: "newp-f1", className: "input", placeholder: "\u8F38\u5165\u653E\u6B3E\u7DE8\u865F\u6216\u5BA2\u6236\u59D3\u540D", value: query, onChange: (e) => setQuery(e.target.value) }), loans && loans.items.length > 0 && (_jsx("ul", { className: "mt-2 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200", children: loans.items.slice(0, 20).map((loan) => (_jsx("li", { children: _jsxs("button", { type: "button", className: "touch-target flex w-full items-center justify-between px-3 text-left hover:bg-slate-50", onClick: () => setLoanId(loan.id), children: [_jsxs("span", { children: [_jsx("span", { className: "font-medium", children: loan.loanNumber }), _jsx("span", { className: "ml-2 text-xs text-slate-500", children: loan.customer.name })] }), _jsx("span", { className: "tabular text-sm", children: money(loan.totalOutstanding) })] }) }, loan.id))) }))] }))] }), loanId && (_jsxs(_Fragment, { children: [_jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "newp-f2", children: "\u6536\u6B3E\u91D1\u984D *" }), _jsx("input", { id: "newp-f2", className: "input tabular text-lg", inputMode: "decimal", value: amount, onChange: (e) => setAmount(e.target.value), placeholder: "0" }), preview && (_jsxs("button", { type: "button", className: "mt-2 text-xs text-brand-600 hover:underline", onClick: () => setAmount(preview.outstanding.total), children: ["\u5168\u984D\u7D50\u6E05\uFF08", money(preview.outstanding.total), "\uFF09"] }))] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "newp-f3", children: "\u6536\u6B3E\u65B9\u5F0F" }), _jsxs("select", { id: "newp-f3", className: "input", value: method, onChange: (e) => setMethod(e.target.value), children: [_jsx("option", { value: "CASH", children: "\u73FE\u91D1" }), _jsx("option", { value: "BANK_TRANSFER", children: "\u9280\u884C\u8F49\u5E33" }), _jsx("option", { value: "ATM", children: "ATM" }), _jsx("option", { value: "CHECK", children: "\u652F\u7968" })] })] }), previewLoading && _jsx(Loading, { label: "\u8A08\u7B97\u5206\u914D\u4E2D\u2026" }), preview && (_jsxs("div", { className: "rounded-lg border border-slate-200 bg-slate-50 p-4", children: [_jsx("h3", { className: "mb-3 text-sm font-semibold text-slate-700", children: "\u76EE\u524D\u6B20\u6B3E" }), _jsxs("dl", { className: "mb-4 space-y-1.5 text-sm", children: [_jsx(Row, { label: "\u672C\u91D1", value: preview.outstanding.principal }), _jsx(Row, { label: "\u5229\u606F", value: preview.outstanding.interest }), _jsx(Row, { label: "\u8CBB\u7528", value: preview.outstanding.fees }), _jsx("div", { className: "border-t border-slate-300 pt-1.5", children: _jsx(Row, { label: "\u7E3D\u8A08", value: preview.outstanding.total, strong: true }) })] }), _jsx("h3", { className: "mb-3 text-sm font-semibold text-slate-700", children: "\u672C\u6B21\u5206\u914D" }), _jsxs("dl", { className: "space-y-1.5 text-sm", children: [_jsx(Row, { label: "\u5229\u606F", value: preview.allocation.interest }), _jsx(Row, { label: "\u8CBB\u7528", value: preview.allocation.fee }), _jsx(Row, { label: "\u672C\u91D1", value: preview.allocation.principal }), Number(preview.allocation.unallocated) > 0 && (_jsx(Row, { label: "\u672A\u5206\u914D\uFF08\u8D85\u984D\uFF09", value: preview.allocation.unallocated, warn: true }))] })] })), _jsxs("div", { className: "flex justify-end gap-2 border-t border-slate-200 pt-4", children: [_jsx("button", { type: "button", className: "btn-secondary", onClick: () => navigate("/payments"), children: "\u53D6\u6D88" }), _jsx("button", { className: "btn-primary", onClick: () => mutation.mutate(), disabled: mutation.isPending || !amount || Number(amount) <= 0, children: mutation.isPending ? "處理中…" : "確認收款" })] })] }))] })] }));
}
function Row({ label, value, strong, warn, }) {
    return (_jsxs("div", { className: "flex justify-between", children: [_jsx("dt", { className: "text-slate-600", children: label }), _jsx("dd", { className: `tabular ${strong ? "font-semibold" : ""} ${warn ? "text-amber-600" : "text-slate-900"}`, children: money(value) })] }));
}
