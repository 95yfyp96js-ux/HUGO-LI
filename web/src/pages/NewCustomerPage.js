import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { ErrorBanner, PageHeader } from "../components/ui";
const EMPTY = {
    name: "",
    identityNumber: "",
    dateOfBirth: "",
    phone: "",
    email: "",
    address: "",
    employmentStatus: "EMPLOYED",
    employer: "",
    monthlyIncome: "",
};
export function NewCustomerPage() {
    const navigate = useNavigate();
    const [form, setForm] = useState(EMPTY);
    const [scan, setScan] = useState(null);
    const scanMutation = useMutation({
        mutationFn: () => api("/api/customers/identity-scan", { method: "POST", body: {} }),
        onSuccess: setScan,
    });
    const createMutation = useMutation({
        mutationFn: (body) => api("/api/customers", {
            method: "POST",
            body: { ...body, monthlyIncome: body.monthlyIncome || null },
        }),
        onSuccess: (customer) => navigate(`/customers/${customer.id}`),
    });
    function set(key, value) {
        setForm((current) => ({ ...current, [key]: value }));
    }
    /** Scan only pre-fills the form — a human still confirms and submits (§45). */
    function applyScan() {
        if (!scan)
            return;
        setForm((current) => ({
            ...current,
            name: scan.scan.name,
            identityNumber: scan.scan.identityNumber,
            dateOfBirth: scan.scan.dateOfBirth,
            address: scan.scan.address ?? current.address,
        }));
    }
    function onSubmit(event) {
        event.preventDefault();
        createMutation.mutate(form);
    }
    return (_jsxs("div", { className: "mx-auto max-w-3xl", children: [_jsx(PageHeader, { title: "\u65B0\u589E\u5BA2\u6236", subtitle: "\u53EF\u4F7F\u7528\u8B49\u4EF6\u6383\u63CF\u9810\u586B\uFF0C\u4ECD\u9808\u4EBA\u5DE5\u78BA\u8A8D\u5F8C\u624D\u6703\u5EFA\u6A94" }), _jsxs("div", { className: "card mb-4 p-5", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-sm font-semibold text-slate-700", children: "\u8B49\u4EF6\u6383\u63CF\uFF08Mock\uFF09" }), _jsx("p", { className: "mt-1 text-xs text-slate-500", children: "\u6383\u63CF\u7D50\u679C\u4E0D\u6703\u81EA\u52D5\u5EFA\u7ACB\u5BA2\u6236\uFF0C\u5FC5\u9808\u7531\u627F\u8FA6\u4EBA\u54E1\u78BA\u8A8D\u5F8C\u9001\u51FA\u3002" })] }), _jsx("button", { type: "button", className: "btn-secondary", onClick: () => scanMutation.mutate(), disabled: scanMutation.isPending, children: scanMutation.isPending ? "掃描中…" : "掃描證件" })] }), scan && (_jsxs("div", { className: "mt-4 rounded-lg border border-brand-200 bg-brand-50 p-4", children: [_jsxs("div", { className: "text-sm font-medium text-brand-900", children: ["\u8FA8\u8B58\u7D50\u679C\uFF08\u4FE1\u5FC3\u5EA6 ", (scan.scan.confidence * 100).toFixed(0), "%\uFF09"] }), _jsxs("dl", { className: "mt-2 grid grid-cols-2 gap-2 text-sm text-slate-700", children: [_jsxs("div", { children: ["\u59D3\u540D\uFF1A", scan.scan.name] }), _jsxs("div", { children: ["\u8EAB\u5206\u8B49\u5B57\u865F\uFF1A", scan.scan.identityNumber] }), _jsxs("div", { children: ["\u51FA\u751F\u65E5\u671F\uFF1A", scan.scan.dateOfBirth] }), _jsxs("div", { className: "col-span-2", children: ["\u5730\u5740\uFF1A", scan.scan.address] })] }), scan.matchedCustomer ? (_jsxs("div", { className: "mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800", children: ["\u6B64\u8B49\u4EF6\u5DF2\u6709\u5BA2\u6236\u8CC7\u6599\uFF1A", scan.matchedCustomer.customerNumber, " ", scan.matchedCustomer.name] })) : (_jsx("button", { type: "button", className: "btn-primary mt-3 text-xs", onClick: applyScan, children: "\u78BA\u8A8D\u4E26\u5E36\u5165\u8868\u55AE" }))] }))] }), _jsxs("form", { onSubmit: onSubmit, className: "card space-y-4 p-5", children: [_jsx(ErrorBanner, { error: createMutation.error }), _jsxs("div", { className: "grid gap-4 sm:grid-cols-2", children: [_jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "newc-f1", children: "\u59D3\u540D *" }), _jsx("input", { id: "newc-f1", className: "input", value: form.name, onChange: (e) => set("name", e.target.value), required: true })] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "newc-f2", children: "\u8EAB\u5206\u8B49\u5B57\u865F *" }), _jsx("input", { id: "newc-f2", className: "input", value: form.identityNumber, onChange: (e) => set("identityNumber", e.target.value), required: true })] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "newc-f3", children: "\u51FA\u751F\u65E5\u671F *" }), _jsx("input", { id: "newc-f3", type: "date", className: "input", value: form.dateOfBirth, onChange: (e) => set("dateOfBirth", e.target.value), required: true })] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "newc-f4", children: "\u624B\u6A5F *" }), _jsx("input", { id: "newc-f4", className: "input", inputMode: "numeric", value: form.phone, onChange: (e) => set("phone", e.target.value), required: true })] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "newc-f5", children: "\u96FB\u5B50\u90F5\u4EF6" }), _jsx("input", { id: "newc-f5", type: "email", className: "input", value: form.email, onChange: (e) => set("email", e.target.value) })] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "newc-f6", children: "\u6708\u6536\u5165" }), _jsx("input", { id: "newc-f6", className: "input tabular", inputMode: "decimal", value: form.monthlyIncome, onChange: (e) => set("monthlyIncome", e.target.value) })] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "newc-f7", children: "\u5C31\u696D\u72C0\u614B" }), _jsxs("select", { id: "newc-f7", className: "input", value: form.employmentStatus, onChange: (e) => set("employmentStatus", e.target.value), children: [_jsx("option", { value: "EMPLOYED", children: "\u53D7\u50F1" }), _jsx("option", { value: "SELF_EMPLOYED", children: "\u81EA\u71DF" }), _jsx("option", { value: "UNEMPLOYED", children: "\u7121\u696D" }), _jsx("option", { value: "RETIRED", children: "\u9000\u4F11" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "newc-f8", children: "\u4EFB\u8077\u516C\u53F8" }), _jsx("input", { id: "newc-f8", className: "input", value: form.employer, onChange: (e) => set("employer", e.target.value) })] }), _jsxs("div", { className: "sm:col-span-2", children: [_jsx("label", { className: "label", htmlFor: "newc-f9", children: "\u5730\u5740" }), _jsx("input", { id: "newc-f9", className: "input", value: form.address, onChange: (e) => set("address", e.target.value) })] })] }), _jsxs("div", { className: "flex justify-end gap-2 border-t border-slate-200 pt-4", children: [_jsx("button", { type: "button", className: "btn-secondary", onClick: () => navigate("/customers"), children: "\u53D6\u6D88" }), _jsx("button", { type: "submit", className: "btn-primary", disabled: createMutation.isPending, children: createMutation.isPending ? "建立中…" : "建立客戶" })] })] })] }));
}
