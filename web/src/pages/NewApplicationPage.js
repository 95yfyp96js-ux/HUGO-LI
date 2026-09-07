import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { ErrorBanner, Loading, PageHeader } from "../components/ui";
export function NewApplicationPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [customerId, setCustomerId] = useState(searchParams.get("customerId") ?? "");
    const [customerQuery, setCustomerQuery] = useState("");
    const [form, setForm] = useState({
        requestedProductId: "",
        requestedAmount: "",
        requestedTermMonths: "3",
        purpose: "",
        income: "",
        existingDebt: "",
    });
    const { data: products, isLoading: productsLoading } = useQuery({
        queryKey: ["products", "ACTIVE"],
        queryFn: () => api("/api/products", { query: { status: "ACTIVE" } }),
    });
    const { data: customers } = useQuery({
        queryKey: ["customers", customerQuery],
        queryFn: () => api("/api/customers", { query: { q: customerQuery, take: 10 } }),
        enabled: customerQuery.length > 0,
    });
    const mutation = useMutation({
        mutationFn: () => api("/api/lending/applications", {
            method: "POST",
            body: {
                customerId,
                requestedProductId: form.requestedProductId,
                requestedAmount: form.requestedAmount,
                requestedTermMonths: Number(form.requestedTermMonths),
                purpose: form.purpose || null,
                income: form.income || null,
                existingDebt: form.existingDebt || null,
            },
        }),
        onSuccess: (application) => navigate(`/lending/applications/${application.id}`),
    });
    const selectedProduct = products?.items.find((p) => p.id === form.requestedProductId);
    function onSubmit(event) {
        event.preventDefault();
        mutation.mutate();
    }
    if (productsLoading)
        return _jsx(Loading, {});
    return (_jsxs("div", { className: "mx-auto max-w-3xl", children: [_jsx(PageHeader, { title: "\u65B0\u589E\u653E\u6B3E\u7533\u8ACB", subtitle: "\u9001\u51FA\u5F8C\u7CFB\u7D71\u6703\u81EA\u52D5\u57F7\u884C\u98A8\u63A7\u3001\u984D\u5EA6\u8207\u5B9A\u50F9" }), _jsxs("form", { onSubmit: onSubmit, className: "card space-y-5 p-5", children: [_jsx(ErrorBanner, { error: mutation.error }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "newa-f1", children: "\u5BA2\u6236 *" }), customerId ? (_jsxs("div", { className: "flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 px-3 py-2", children: [_jsx("span", { className: "text-sm font-medium text-brand-900", children: customers?.items.find((c) => c.id === customerId)?.name ?? "已選擇客戶" }), _jsx("button", { type: "button", className: "text-xs text-brand-700 underline", onClick: () => setCustomerId(""), children: "\u66F4\u63DB" })] })) : (_jsxs(_Fragment, { children: [_jsx("input", { id: "newa-f1", className: "input", placeholder: "\u641C\u5C0B\u5BA2\u6236\u59D3\u540D\u6216\u7DE8\u865F", value: customerQuery, onChange: (e) => setCustomerQuery(e.target.value) }), customers && customers.items.length > 0 && (_jsx("ul", { className: "mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200", children: customers.items.map((customer) => (_jsx("li", { children: _jsxs("button", { type: "button", className: "w-full px-3 py-2 text-left text-sm hover:bg-slate-50", onClick: () => setCustomerId(customer.id), children: [customer.name, _jsx("span", { className: "ml-2 text-xs text-slate-400", children: customer.customerNumber })] }) }, customer.id))) }))] }))] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "newa-f2", children: "\u653E\u6B3E\u7522\u54C1 *" }), _jsxs("select", { id: "newa-f2", className: "input", value: form.requestedProductId, onChange: (e) => setForm((f) => ({ ...f, requestedProductId: e.target.value })), required: true, children: [_jsx("option", { value: "", children: "\u8ACB\u9078\u64C7\u7522\u54C1" }), products?.items.map((product) => (_jsxs("option", { value: product.id, children: [product.name, "\uFF08", product.ratePercent, "%", product.rateUnit === "MONTHLY" ? "／月" : product.rateUnit === "DAILY" ? "／日" : "／年", "\uFF09"] }, product.id)))] }), selectedProduct && (_jsxs("p", { className: "mt-1 text-xs text-slate-500", children: ["\u91D1\u984D ", selectedProduct.minAmount, " ~ ", selectedProduct.maxAmount, "\uFF0C\u671F\u6578", " ", selectedProduct.minTermMonths, " ~ ", selectedProduct.maxTermMonths, " \u671F"] }))] }), _jsxs("div", { className: "grid gap-4 sm:grid-cols-2", children: [_jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "newa-f3", children: "\u7533\u8ACB\u91D1\u984D *" }), _jsx("input", { id: "newa-f3", className: "input tabular", inputMode: "decimal", value: form.requestedAmount, onChange: (e) => setForm((f) => ({ ...f, requestedAmount: e.target.value })), required: true })] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "newa-f4", children: "\u7533\u8ACB\u671F\u6578 *" }), _jsx("input", { id: "newa-f4", className: "input tabular", inputMode: "numeric", value: form.requestedTermMonths, onChange: (e) => setForm((f) => ({ ...f, requestedTermMonths: e.target.value })), required: true })] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "newa-f5", children: "\u6708\u6536\u5165" }), _jsx("input", { id: "newa-f5", className: "input tabular", inputMode: "decimal", value: form.income, onChange: (e) => setForm((f) => ({ ...f, income: e.target.value })) })] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "newa-f6", children: "\u73FE\u6709\u8CA0\u50B5" }), _jsx("input", { id: "newa-f6", className: "input tabular", inputMode: "decimal", value: form.existingDebt, onChange: (e) => setForm((f) => ({ ...f, existingDebt: e.target.value })) })] }), _jsxs("div", { className: "sm:col-span-2", children: [_jsx("label", { className: "label", htmlFor: "newa-f7", children: "\u501F\u6B3E\u7528\u9014" }), _jsx("input", { id: "newa-f7", className: "input", value: form.purpose, onChange: (e) => setForm((f) => ({ ...f, purpose: e.target.value })) })] })] }), _jsxs("div", { className: "flex justify-end gap-2 border-t border-slate-200 pt-4", children: [_jsx("button", { type: "button", className: "btn-secondary", onClick: () => navigate("/lending/applications"), children: "\u53D6\u6D88" }), _jsx("button", { type: "submit", className: "btn-primary", disabled: mutation.isPending || !customerId || !form.requestedProductId, children: mutation.isPending ? "建立中…" : "建立申請" })] })] })] }));
}
