import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, newIdempotencyKey } from "../lib/api";
import { date, money, percent, REPAYMENT_METHOD_LABELS } from "../lib/format";
import { ErrorBanner, Field, Loading, PageHeader, RiskGradeBadge } from "../components/ui";
/**
 * The origination wizard (§35). Every figure shown here — risk score, limit,
 * rate, interest, schedule — is produced by the backend engines. The wizard
 * only sequences the steps and displays what the server returns.
 */
const STEPS = [
    { id: 1, label: "選擇客戶" },
    { id: 2, label: "放款申請" },
    { id: 3, label: "風控與額度" },
    { id: 4, label: "放款條件" },
    { id: 5, label: "審核核准" },
    { id: 6, label: "建立放款" },
    { id: 7, label: "撥款" },
];
export function NewLoanPage() {
    const navigate = useNavigate();
    const [step, setStep] = useState(1);
    const [customer, setCustomer] = useState(null);
    const [customerQuery, setCustomerQuery] = useState("");
    const [form, setForm] = useState({
        requestedProductId: "",
        requestedAmount: "",
        requestedTermMonths: "3",
        purpose: "",
        income: "",
        existingDebt: "",
    });
    const [applicationId, setApplicationId] = useState(null);
    const [underwriting, setUnderwriting] = useState(null);
    const [loan, setLoan] = useState(null);
    const [idempotencyKey] = useState(newIdempotencyKey);
    const { data: customers } = useQuery({
        queryKey: ["customers", customerQuery],
        queryFn: () => api("/api/customers", { query: { q: customerQuery, take: 10 } }),
        enabled: customerQuery.length > 0,
    });
    const { data: products, isLoading: productsLoading } = useQuery({
        queryKey: ["products", "ACTIVE"],
        queryFn: () => api("/api/products", { query: { status: "ACTIVE" } }),
    });
    const createApplication = useMutation({
        mutationFn: () => api("/api/lending/applications", {
            method: "POST",
            body: {
                customerId: customer.id,
                requestedProductId: form.requestedProductId,
                requestedAmount: form.requestedAmount,
                requestedTermMonths: Number(form.requestedTermMonths),
                purpose: form.purpose || null,
                income: form.income || null,
                existingDebt: form.existingDebt || null,
            },
        }),
        onSuccess: (application) => {
            setApplicationId(application.id);
            submitApplication.mutate(application.id);
        },
    });
    const submitApplication = useMutation({
        mutationFn: (id) => api(`/api/lending/applications/${id}/submit`, { method: "POST" }),
        onSuccess: (result) => {
            setUnderwriting(result);
            setStep(3);
        },
    });
    const approve = useMutation({
        mutationFn: () => api(`/api/lending/applications/${applicationId}/approve`, {
            method: "POST",
            body: { reason: "符合授信條件" },
        }),
        onSuccess: () => setStep(6),
    });
    const createLoan = useMutation({
        mutationFn: () => api("/api/loans", { method: "POST", body: { applicationId } }),
        onSuccess: (created) => {
            setLoan(created);
            setStep(7);
        },
    });
    const disburse = useMutation({
        mutationFn: () => api(`/api/loans/${loan.id}/disburse`, {
            method: "POST",
            idempotencyKey,
            body: { method: "BANK_TRANSFER" },
        }),
        onSuccess: () => navigate(`/loans/${loan.id}`),
    });
    const pendingError = createApplication.error ??
        submitApplication.error ??
        approve.error ??
        createLoan.error ??
        disburse.error;
    if (productsLoading)
        return _jsx(Loading, {});
    return (_jsxs("div", { className: "mx-auto max-w-4xl", children: [_jsx(PageHeader, { title: "\u65B0\u589E\u653E\u6B3E", subtitle: "\u6240\u6709\u91D1\u984D\u3001\u5229\u7387\u8207\u671F\u7A0B\u7686\u7531\u5F8C\u7AEF\u5F15\u64CE\u8A08\u7B97" }), _jsx("ol", { className: "mb-6 flex flex-wrap gap-2", children: STEPS.map((s) => (_jsxs("li", { className: `flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${step === s.id
                        ? "bg-brand-600 text-white"
                        : step > s.id
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"}`, children: [_jsx("span", { children: step > s.id ? "✓" : s.id }), s.label] }, s.id))) }), _jsx(ErrorBanner, { error: pendingError }), step === 1 && (_jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-4 text-sm font-semibold text-slate-700", children: "\u9078\u64C7\u5BA2\u6236" }), _jsx("input", { className: "input", placeholder: "\u641C\u5C0B\u5BA2\u6236\u59D3\u540D\u3001\u7DE8\u865F\u6216\u96FB\u8A71", value: customerQuery, onChange: (e) => setCustomerQuery(e.target.value) }), customers && customers.items.length > 0 && (_jsx("ul", { className: "mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200", children: customers.items.map((c) => (_jsx("li", { children: _jsxs("button", { className: "flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50", onClick: () => {
                                    setCustomer(c);
                                    setStep(2);
                                }, children: [_jsxs("span", { children: [_jsx("span", { className: "font-medium", children: c.name }), _jsx("span", { className: "ml-2 text-xs text-slate-400", children: c.customerNumber })] }), _jsxs("span", { className: "tabular text-sm text-slate-500", children: ["\u76EE\u524D\u6B20\u6B3E ", money(c.totalOutstanding)] })] }) }, c.id))) })), _jsxs("p", { className: "mt-4 text-sm text-slate-500", children: ["\u627E\u4E0D\u5230\u5BA2\u6236\uFF1F", _jsx(Link, { to: "/customers/new", className: "ml-1 text-brand-600 hover:underline", children: "\u5148\u5EFA\u7ACB\u65B0\u5BA2\u6236" })] })] })), step === 2 && customer && (_jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-1 text-sm font-semibold text-slate-700", children: "\u653E\u6B3E\u7533\u8ACB\u5167\u5BB9" }), _jsxs("p", { className: "mb-4 text-xs text-slate-500", children: ["\u5BA2\u6236\uFF1A", customer.name, "\uFF08", customer.customerNumber, "\uFF09"] }), _jsxs("div", { className: "grid gap-4 sm:grid-cols-2", children: [_jsxs("div", { className: "sm:col-span-2", children: [_jsx("label", { className: "label", htmlFor: "newl-f1", children: "\u653E\u6B3E\u7522\u54C1 *" }), _jsxs("select", { id: "newl-f1", className: "input", value: form.requestedProductId, onChange: (e) => setForm((f) => ({ ...f, requestedProductId: e.target.value })), children: [_jsx("option", { value: "", children: "\u8ACB\u9078\u64C7\u7522\u54C1" }), products?.items.map((product) => (_jsxs("option", { value: product.id, children: [product.name, "\uFF08", percent(product.ratePercent, product.rateUnit), "\uFF09"] }, product.id)))] })] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "newl-f2", children: "\u7533\u8ACB\u91D1\u984D *" }), _jsx("input", { id: "newl-f2", className: "input tabular", inputMode: "decimal", value: form.requestedAmount, onChange: (e) => setForm((f) => ({ ...f, requestedAmount: e.target.value })) })] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "newl-f3", children: "\u671F\u6578 *" }), _jsx("input", { id: "newl-f3", className: "input tabular", inputMode: "numeric", value: form.requestedTermMonths, onChange: (e) => setForm((f) => ({ ...f, requestedTermMonths: e.target.value })) })] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "newl-f4", children: "\u6708\u6536\u5165" }), _jsx("input", { id: "newl-f4", className: "input tabular", inputMode: "decimal", value: form.income, onChange: (e) => setForm((f) => ({ ...f, income: e.target.value })) })] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "newl-f5", children: "\u73FE\u6709\u8CA0\u50B5" }), _jsx("input", { id: "newl-f5", className: "input tabular", inputMode: "decimal", value: form.existingDebt, onChange: (e) => setForm((f) => ({ ...f, existingDebt: e.target.value })) })] }), _jsxs("div", { className: "sm:col-span-2", children: [_jsx("label", { className: "label", htmlFor: "newl-f6", children: "\u501F\u6B3E\u7528\u9014" }), _jsx("input", { id: "newl-f6", className: "input", value: form.purpose, onChange: (e) => setForm((f) => ({ ...f, purpose: e.target.value })) })] })] }), _jsxs("div", { className: "mt-5 flex justify-between border-t border-slate-200 pt-4", children: [_jsx("button", { className: "btn-secondary", onClick: () => setStep(1), children: "\u4E0A\u4E00\u6B65" }), _jsx("button", { className: "btn-primary", onClick: () => createApplication.mutate(), disabled: !form.requestedProductId ||
                                    !form.requestedAmount ||
                                    createApplication.isPending ||
                                    submitApplication.isPending, children: createApplication.isPending || submitApplication.isPending
                                    ? "執行風控中…"
                                    : "送出並執行風控" })] })] })), step === 3 && underwriting && (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-4 text-sm font-semibold text-slate-700", children: "\u98A8\u96AA\u8A55\u4F30\u7D50\u679C" }), _jsxs("div", { className: "mb-3 flex items-center gap-3", children: [_jsx(RiskGradeBadge, { grade: underwriting.assessment.grade }), _jsxs("span", { className: "tabular text-xl font-semibold", children: [underwriting.assessment.score, " \u5206"] }), _jsx("span", { className: "text-sm text-slate-500", children: underwriting.assessment.decision })] }), _jsx("ul", { className: "list-inside list-disc space-y-1 text-sm text-slate-600", children: JSON.parse(underwriting.assessment.reasons).map((reason, index) => (_jsx("li", { children: reason }, index))) })] }), _jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-4 text-sm font-semibold text-slate-700", children: "\u653E\u6B3E\u984D\u5EA6" }), _jsxs("dl", { className: "grid grid-cols-2 gap-4 sm:grid-cols-4", children: [_jsx(Field, { label: "\u6838\u5B9A\u4E0A\u9650", children: money(underwriting.limit.maximumLimitCents / 100) }), _jsx(Field, { label: "\u76EE\u524D\u66DD\u96AA", children: money(underwriting.limit.currentExposureCents / 100) }), _jsx(Field, { label: "\u53EF\u52D5\u7528", children: money(underwriting.limit.availableLimitCents / 100) }), _jsx(Field, { label: "\u5EFA\u8B70\u91D1\u984D", children: _jsx("span", { className: "font-semibold text-brand-700", children: money(underwriting.limit.recommendedAmountCents / 100) }) })] })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("button", { className: "btn-secondary", onClick: () => setStep(2), children: "\u4E0A\u4E00\u6B65" }), _jsx("button", { className: "btn-primary", onClick: () => setStep(4), disabled: !underwriting.offer, children: underwriting.offer ? "查看放款條件" : "額度不足，無法承作" })] })] })), step === 4 && underwriting?.offer && (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-4 text-sm font-semibold text-slate-700", children: "\u653E\u6B3E\u689D\u4EF6" }), _jsxs("dl", { className: "grid grid-cols-2 gap-4 sm:grid-cols-3", children: [_jsx(Field, { label: "\u6838\u51C6\u91D1\u984D", children: money(underwriting.offer.approvedAmountCents / 100) }), _jsx(Field, { label: "\u653E\u6B3E\u5229\u7387", children: percent(underwriting.offer.ratePercent, underwriting.offer.rateUnit) }), _jsxs(Field, { label: "\u671F\u6578", children: [underwriting.offer.termMonths, " \u671F"] }), _jsx(Field, { label: "\u9084\u6B3E\u65B9\u5F0F", children: REPAYMENT_METHOD_LABELS[underwriting.offer.repaymentMethod] ??
                                            underwriting.offer.repaymentMethod }), _jsx(Field, { label: "\u7E3D\u5229\u606F", children: money(underwriting.offer.totalInterestCents / 100) }), _jsx(Field, { label: "\u8CBB\u7528", children: money(underwriting.offer.feesCents / 100) })] }), _jsx("div", { className: "mt-4 border-t border-slate-200 pt-4", children: _jsx(Field, { label: "\u7E3D\u61C9\u9084", children: _jsx("span", { className: "text-2xl font-semibold", children: money(underwriting.offer.totalPayableCents / 100) }) }) })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("button", { className: "btn-secondary", onClick: () => setStep(3), children: "\u4E0A\u4E00\u6B65" }), _jsx("button", { className: "btn-primary", onClick: () => setStep(5), children: "\u4E0B\u4E00\u6B65\uFF1A\u5BE9\u6838" })] })] })), step === 5 && (_jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-2 text-sm font-semibold text-slate-700", children: "\u5BE9\u6838\u6838\u51C6" }), _jsx("p", { className: "mb-4 text-sm text-slate-500", children: "\u6838\u51C6\u5F8C\u5C07\u5EFA\u7ACB\u6B63\u5F0F\u653E\u6B3E\u5951\u7D04\uFF0C\u6838\u51C6\u4EBA\u8207\u6838\u51C6\u6642\u9593\u6703\u8A18\u9304\u65BC\u7A3D\u6838\u8ECC\u8DE1\u3002" }), _jsxs("div", { className: "flex justify-between", children: [_jsx("button", { className: "btn-secondary", onClick: () => setStep(4), children: "\u4E0A\u4E00\u6B65" }), _jsx("button", { className: "btn-primary", onClick: () => approve.mutate(), disabled: approve.isPending, children: approve.isPending ? "核准中…" : "核准此申請" })] })] })), step === 6 && (_jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-2 text-sm font-semibold text-slate-700", children: "\u5EFA\u7ACB\u653E\u6B3E" }), _jsx("p", { className: "mb-4 text-sm text-slate-500", children: "\u5EFA\u7ACB\u6642\u6703\u540C\u6642\u9396\u5B9A\u653E\u6B3E\u689D\u4EF6\u5FEB\u7167\u4E26\u7522\u751F\u9084\u6B3E\u671F\u7A0B\uFF08\u55AE\u4E00\u4EA4\u6613\uFF0C\u5931\u6557\u5168\u90E8\u56DE\u6EFE\uFF09\u3002" }), _jsx("button", { className: "btn-primary", onClick: () => createLoan.mutate(), disabled: createLoan.isPending, children: createLoan.isPending ? "建立中…" : "建立放款與還款期程" })] })), step === 7 && loan && (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "card p-5", children: [_jsxs("h2", { className: "mb-4 text-sm font-semibold text-slate-700", children: ["\u9084\u6B3E\u671F\u7A0B\uFF08", loan.loanNumber, "\uFF09"] }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "min-w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-slate-200 text-xs uppercase text-slate-500", children: [_jsx("th", { className: "py-2 text-left", children: "\u671F\u6578" }), _jsx("th", { className: "py-2 text-left", children: "\u61C9\u7E73\u65E5" }), _jsx("th", { className: "py-2 text-right", children: "\u672C\u91D1" }), _jsx("th", { className: "py-2 text-right", children: "\u5229\u606F" }), _jsx("th", { className: "py-2 text-right", children: "\u61C9\u7E73\u5408\u8A08" })] }) }), _jsx("tbody", { className: "divide-y divide-slate-100", children: loan.scheduleLines.map((line) => (_jsxs("tr", { children: [_jsx("td", { className: "tabular py-2", children: line.installmentNumber }), _jsx("td", { className: "py-2", children: date(line.dueDate) }), _jsx("td", { className: "tabular py-2 text-right", children: money(line.principalDueCents / 100) }), _jsx("td", { className: "tabular py-2 text-right", children: money(line.interestDueCents / 100) }), _jsx("td", { className: "tabular py-2 text-right font-medium", children: money(line.totalDueCents / 100) })] }, line.id))) })] }) })] }), _jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-2 text-sm font-semibold text-slate-700", children: "\u64A5\u6B3E" }), _jsx("p", { className: "mb-4 text-sm text-slate-500", children: "\u78BA\u8A8D\u5F8C\u5C07\u64A5\u6B3E\u4E26\u4F7F Loan \u9032\u5165\u653E\u6B3E\u4E2D\u72C0\u614B\u3002\u6B64\u64CD\u4F5C\u5177\u5099 Idempotency-Key \u4FDD\u8B77\u3002" }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { className: "btn-primary", onClick: () => disburse.mutate(), disabled: disburse.isPending, children: disburse.isPending ? "撥款中…" : "確認撥款" }), _jsx("button", { className: "btn-secondary", onClick: () => navigate(`/loans/${loan.id}`), children: "\u7A0D\u5F8C\u64A5\u6B3E" })] })] })] }))] }));
}
