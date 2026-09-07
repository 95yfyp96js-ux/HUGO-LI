import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { dateTime } from "../lib/format";
import { DataTable, ErrorBanner, Loading, Money, PageHeader, StatusBadge } from "../components/ui";
import { useAuth } from "../lib/auth";
export function PaymentsPage() {
    const { can } = useAuth();
    const queryClient = useQueryClient();
    const [reversing, setReversing] = useState(null);
    const [reason, setReason] = useState("");
    const { data, isLoading, error } = useQuery({
        queryKey: ["payments"],
        queryFn: () => api("/api/payments", { query: { take: 50 } }),
    });
    const reverseMutation = useMutation({
        mutationFn: () => api(`/api/payments/${reversing.id}/reverse`, { method: "POST", body: { reason } }),
        onSuccess: () => {
            setReversing(null);
            setReason("");
            queryClient.invalidateQueries({ queryKey: ["payments"] });
            queryClient.invalidateQueries({ queryKey: ["loans"] });
        },
    });
    return (_jsxs("div", { children: [_jsx(PageHeader, { title: "\u6536\u6B3E\u7D00\u9304", subtitle: data ? `共 ${data.total} 筆收款` : undefined, actions: can("PAYMENT_CREATE") && (_jsx(Link, { to: "/payments/new", className: "btn-primary", children: "\u5FEB\u901F\u6536\u6B3E" })) }), _jsx(ErrorBanner, { error: error }), isLoading ? (_jsx(Loading, {})) : (_jsx(DataTable, { rows: data?.items ?? [], rowKey: (row) => row.id, empty: "\u5C1A\u7121\u6536\u6B3E\u7D00\u9304", columns: [
                    { header: "收款編號", cell: (row) => _jsx("span", { className: "tabular", children: row.paymentNumber }) },
                    { header: "收款時間", cell: (row) => dateTime(row.paidAt) },
                    {
                        header: "客戶",
                        cell: (row) => (_jsx(Link, { to: `/customers/${row.customer.id}`, className: "hover:underline", children: row.customer.name })),
                    },
                    {
                        header: "放款",
                        cell: (row) => (_jsx(Link, { to: `/loans/${row.loan.id}`, className: "text-brand-600 hover:underline", children: row.loan.loanNumber })),
                    },
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
                    { header: "方式", cell: (row) => row.method },
                    {
                        header: "狀態",
                        cell: (row) => _jsx(StatusBadge, { status: row.status === "CONFIRMED" ? "PAID" : row.status }),
                    },
                    {
                        header: "操作",
                        cell: (row) => can("PAYMENT_REVERSE") && row.status === "CONFIRMED" ? (_jsx("button", { className: "text-xs text-rose-600 hover:underline", onClick: () => setReversing(row), children: "\u6C96\u92B7" })) : null,
                    },
                ] })), reversing && (_jsx("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4", children: _jsxs("div", { className: "w-full max-w-md rounded-2xl bg-white p-6", children: [_jsxs("h2", { className: "text-lg font-semibold", children: ["\u6C96\u92B7\u6536\u6B3E ", reversing.paymentNumber] }), _jsx("p", { className: "mt-1 text-sm text-slate-500", children: "\u6C96\u92B7\u4E0D\u6703\u522A\u9664\u539F\u7D00\u9304\uFF0C\u7CFB\u7D71\u6703\u7522\u751F\u4E00\u7B46\u53CD\u5411\u91D1\u6D41\u4E8B\u4EF6\u4E26\u56DE\u5FA9\u9918\u984D\u3002" }), _jsx("textarea", { className: "input mt-4", rows: 3, value: reason, onChange: (e) => setReason(e.target.value), placeholder: "\u8ACB\u8AAA\u660E\u6C96\u92B7\u539F\u56E0" }), _jsx(ErrorBanner, { error: reverseMutation.error }), _jsxs("div", { className: "mt-4 flex justify-end gap-2", children: [_jsx("button", { className: "btn-secondary", onClick: () => setReversing(null), children: "\u53D6\u6D88" }), _jsx("button", { className: "btn-danger", onClick: () => reverseMutation.mutate(), disabled: !reason.trim() || reverseMutation.isPending, children: "\u78BA\u8A8D\u6C96\u92B7" })] })] }) }))] }));
}
