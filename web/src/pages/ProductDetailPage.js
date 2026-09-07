import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { date, percent, REPAYMENT_METHOD_LABELS } from "../lib/format";
import { ErrorBanner, Field, Loading, Money, PageHeader, StatusBadge } from "../components/ui";
import { useAuth } from "../lib/auth";
export function ProductDetailPage() {
    const { id } = useParams();
    const { can } = useAuth();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState(false);
    const [rate, setRate] = useState("");
    const { data, isLoading, error } = useQuery({
        queryKey: ["product", id],
        queryFn: () => api(`/api/products/${id}`),
    });
    const mutation = useMutation({
        mutationFn: () => api(`/api/products/${id}`, { method: "PATCH", body: { ratePercent: Number(rate) } }),
        onSuccess: (updated) => {
            setEditing(false);
            queryClient.invalidateQueries({ queryKey: ["products"] });
            // Repricing produces a new version with a new id.
            navigate(`/products/${updated.id}`);
        },
    });
    if (isLoading)
        return _jsx(Loading, {});
    if (error)
        return _jsx(ErrorBanner, { error: error });
    if (!data)
        return null;
    return (_jsxs("div", { className: "mx-auto max-w-3xl", children: [_jsx(PageHeader, { title: data.name, subtitle: `${data.productCode} ・ v${data.version}`, actions: can("PRODUCT_UPDATE") &&
                    data.status === "ACTIVE" && (_jsx("button", { className: "btn-secondary", onClick: () => {
                        setRate(String(data.ratePercent));
                        setEditing(true);
                    }, children: "\u8ABF\u6574\u5229\u7387" })) }), _jsxs("div", { className: "card p-5", children: [_jsxs("dl", { className: "grid grid-cols-2 gap-4 sm:grid-cols-3", children: [_jsx(Field, { label: "\u72C0\u614B", children: _jsx(StatusBadge, { status: data.status === "ARCHIVED" ? "CANCELLED" : data.status }) }), _jsx(Field, { label: "\u5229\u7387", children: percent(data.ratePercent, data.rateUnit) }), _jsx(Field, { label: "\u8A08\u606F\u65B9\u5F0F", children: data.calculationMethod }), _jsx(Field, { label: "\u9084\u6B3E\u65B9\u5F0F", children: REPAYMENT_METHOD_LABELS[data.repaymentMethod] ?? data.repaymentMethod }), _jsx(Field, { label: "\u6700\u4F4E\u91D1\u984D", children: _jsx(Money, { value: data.minAmount }) }), _jsx(Field, { label: "\u6700\u9AD8\u91D1\u984D", children: _jsx(Money, { value: data.maxAmount }) }), _jsxs(Field, { label: "\u671F\u6578\u7BC4\u570D", children: [data.minTermMonths, " ~ ", data.maxTermMonths, " \u671F"] }), _jsxs(Field, { label: "\u7248\u672C", children: ["v", data.version] }), _jsx(Field, { label: "\u5EFA\u7ACB\u65E5\u671F", children: date(data.createdAt) }), _jsx("div", { className: "col-span-2 sm:col-span-3", children: _jsx(Field, { label: "\u8AAA\u660E", children: data.description ?? "—" }) })] }), _jsx("h2", { className: "mb-3 mt-6 text-sm font-semibold text-slate-700", children: "\u8CBB\u7528\u898F\u5247" }), data.feeRules.length === 0 ? (_jsx("p", { className: "text-sm text-slate-500", children: "\u7121\u984D\u5916\u8CBB\u7528" })) : (_jsx("ul", { className: "space-y-2", children: data.feeRules.map((fee) => (_jsxs("li", { className: "flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm", children: [_jsx("span", { children: fee.label }), _jsx("span", { className: "tabular font-medium", children: fee.type === "PERCENT_OF_PRINCIPAL" ? `${fee.value}%` : `NT$${fee.value}` })] }, fee.code))) }))] }), editing && (_jsx("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4", children: _jsxs("div", { className: "w-full max-w-md rounded-2xl bg-white p-6", children: [_jsx("h2", { className: "text-lg font-semibold", children: "\u8ABF\u6574\u7522\u54C1\u5229\u7387" }), _jsxs("p", { className: "mt-1 text-sm text-slate-500", children: ["\u8ABF\u6574\u5229\u7387\u6703\u5EFA\u7ACB\u65B0\u7248\u672C\uFF08v", data.version + 1, "\uFF09\u4E26\u5C01\u5B58\u76EE\u524D\u7248\u672C\u3002\u65E2\u6709\u653E\u6B3E\u7684\u689D\u4EF6\u5FEB\u7167\u4E0D\u53D7\u5F71\u97FF\u3002"] }), _jsxs("div", { className: "mt-4", children: [_jsx("label", { className: "label", htmlFor: "prod-f1", children: "\u65B0\u5229\u7387\uFF08%\uFF09" }), _jsx("input", { id: "prod-f1", className: "input tabular", inputMode: "decimal", value: rate, onChange: (e) => setRate(e.target.value) })] }), _jsx(ErrorBanner, { error: mutation.error }), _jsxs("div", { className: "mt-4 flex justify-end gap-2", children: [_jsx("button", { className: "btn-secondary", onClick: () => setEditing(false), children: "\u53D6\u6D88" }), _jsx("button", { className: "btn-primary", onClick: () => mutation.mutate(), disabled: mutation.isPending, children: mutation.isPending ? "建立中…" : "建立新版本" })] })] }) }))] }));
}
