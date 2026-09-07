import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { date, dateTime, money, percent, REPAYMENT_METHOD_LABELS } from "../lib/format";
import { ErrorBanner, Field, Loading, PageHeader, RiskGradeBadge, StatusBadge, } from "../components/ui";
import { useAuth } from "../lib/auth";
export function ApplicationDetailPage() {
    const { id } = useParams();
    const { can } = useAuth();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [rejectReason, setRejectReason] = useState("");
    const [showReject, setShowReject] = useState(false);
    const { data, isLoading, error } = useQuery({
        queryKey: ["application", id],
        queryFn: () => api(`/api/lending/applications/${id}`),
    });
    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ["application", id] });
        queryClient.invalidateQueries({ queryKey: ["applications"] });
    };
    const submitMutation = useMutation({
        mutationFn: () => api(`/api/lending/applications/${id}/submit`, { method: "POST" }),
        onSuccess: invalidate,
    });
    const approveMutation = useMutation({
        mutationFn: () => api(`/api/lending/applications/${id}/approve`, {
            method: "POST",
            body: { reason: "符合授信條件" },
        }),
        onSuccess: invalidate,
    });
    const rejectMutation = useMutation({
        mutationFn: () => api(`/api/lending/applications/${id}/reject`, { method: "POST", body: { reason: rejectReason } }),
        onSuccess: () => {
            setShowReject(false);
            invalidate();
        },
    });
    const createLoanMutation = useMutation({
        mutationFn: () => api("/api/loans", { method: "POST", body: { applicationId: id } }),
        onSuccess: (loan) => navigate(`/loans/${loan.id}`),
    });
    if (isLoading)
        return _jsx(Loading, {});
    if (error)
        return _jsx(ErrorBanner, { error: error });
    if (!data)
        return null;
    const risk = data.riskAssessments[0];
    const limit = data.lendingLimits[0];
    const offer = data.loanOffers[0];
    const approval = data.approvals[0];
    const reasons = risk ? JSON.parse(risk.reasons) : [];
    const limitReasons = limit ? JSON.parse(limit.reasons) : [];
    const canDecide = ["UNDER_REVIEW", "RISK_REVIEW"].includes(data.status);
    return (_jsxs("div", { children: [_jsx(PageHeader, { title: data.applicationNumber, subtitle: `${data.customer.name}（${data.customer.customerNumber}）`, actions: _jsxs(_Fragment, { children: [data.status === "DRAFT" && can("APPLICATION_UPDATE") && (_jsx("button", { className: "btn-primary", onClick: () => submitMutation.mutate(), disabled: submitMutation.isPending, children: submitMutation.isPending ? "審核中…" : "送出申請（執行風控）" })), canDecide && can("APPLICATION_APPROVE") && (_jsx("button", { className: "btn-primary", onClick: () => approveMutation.mutate(), disabled: approveMutation.isPending || !offer, children: "\u6838\u51C6" })), canDecide && can("APPLICATION_REJECT") && (_jsx("button", { className: "btn-danger", onClick: () => setShowReject(true), children: "\u5A49\u62D2" })), data.status === "APPROVED" && !data.loan && can("LOAN_CREATE") && (_jsx("button", { className: "btn-primary", onClick: () => createLoanMutation.mutate(), disabled: createLoanMutation.isPending, children: createLoanMutation.isPending ? "建立中…" : "建立放款" })), data.loan && (_jsxs(Link, { to: `/loans/${data.loan.id}`, className: "btn-secondary", children: ["\u524D\u5F80\u653E\u6B3E ", data.loan.loanNumber] }))] }) }), _jsx(ErrorBanner, { error: submitMutation.error ?? approveMutation.error ?? rejectMutation.error ?? createLoanMutation.error }), _jsxs("div", { className: "mb-4 flex items-center gap-3", children: [_jsx(StatusBadge, { status: data.status, kind: "application" }), risk && _jsx(RiskGradeBadge, { grade: risk.grade }), _jsxs("span", { className: "text-sm text-slate-500", children: ["\u7533\u8ACB\u65E5 ", date(data.createdAt)] })] }), _jsxs("div", { className: "grid gap-4 lg:grid-cols-2", children: [_jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-4 text-sm font-semibold text-slate-700", children: "\u7533\u8ACB\u5167\u5BB9" }), _jsxs("dl", { className: "grid grid-cols-2 gap-4", children: [_jsx(Field, { label: "\u7533\u8ACB\u91D1\u984D", children: money(data.requestedAmountCents / 100) }), _jsxs(Field, { label: "\u7533\u8ACB\u671F\u6578", children: [data.requestedTermMonths, " \u671F"] }), _jsx(Field, { label: "\u7522\u54C1", children: data.requestedProduct.name }), _jsx(Field, { label: "\u7522\u54C1\u5229\u7387", children: percent(data.requestedProduct.ratePercent, data.requestedProduct.rateUnit) }), _jsx(Field, { label: "\u7533\u5831\u6708\u6536\u5165", children: money(data.incomeCents ? data.incomeCents / 100 : null) }), _jsx(Field, { label: "\u73FE\u6709\u8CA0\u50B5", children: money(data.existingDebtCents ? data.existingDebtCents / 100 : null) }), _jsx("div", { className: "col-span-2", children: _jsx(Field, { label: "\u501F\u6B3E\u7528\u9014", children: data.purpose ?? "—" }) })] }), _jsx("h2", { className: "mb-3 mt-6 text-sm font-semibold text-slate-700", children: "\u5BA2\u6236\u6982\u6CC1" }), _jsxs("dl", { className: "grid grid-cols-2 gap-4", children: [_jsx(Field, { label: "\u5BA2\u6236\u72C0\u614B", children: _jsx(StatusBadge, { status: data.customer.status }) }), _jsx(Field, { label: "\u96FB\u8A71", children: data.customer.phone }), _jsx(Field, { label: "\u4EFB\u8077\u516C\u53F8", children: data.customer.employer ?? "—" }), _jsx(Field, { label: "\u767B\u9304\u6708\u6536\u5165", children: money(data.customer.monthlyIncomeCents ? data.customer.monthlyIncomeCents / 100 : null) }), _jsx("div", { className: "col-span-2", children: _jsx(Link, { to: `/customers/${data.customer.id}`, className: "text-sm text-brand-600 hover:underline", children: "\u67E5\u770B\u5BA2\u6236 360 \u2192" }) })] })] }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-4 text-sm font-semibold text-slate-700", children: "\u98A8\u96AA\u8A55\u4F30" }), risk ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "mb-3 flex items-center gap-3", children: [_jsx(RiskGradeBadge, { grade: risk.grade }), _jsxs("span", { className: "tabular text-xl font-semibold", children: [risk.score, " \u5206"] }), _jsx("span", { className: "text-sm text-slate-500", children: risk.decision })] }), _jsx("ul", { className: "mb-4 list-inside list-disc space-y-1 text-sm text-slate-600", children: reasons.map((reason, index) => (_jsx("li", { children: reason }, index))) }), _jsx("table", { className: "w-full text-sm", children: _jsx("tbody", { className: "divide-y divide-slate-100", children: risk.factors.map((factor) => (_jsxs("tr", { children: [_jsx("td", { className: "py-1.5 text-slate-600", children: factor.label }), _jsx("td", { className: "py-1.5 text-right text-slate-500", children: factor.value }), _jsx("td", { className: `tabular w-16 py-1.5 text-right font-medium ${factor.points > 0
                                                                    ? "text-rose-600"
                                                                    : factor.points < 0
                                                                        ? "text-emerald-600"
                                                                        : "text-slate-400"}`, children: factor.points > 0 ? `+${factor.points}` : factor.points })] }, factor.code))) }) }), _jsxs("p", { className: "mt-3 text-xs text-slate-400", children: ["\u6A21\u578B\u7248\u672C ", risk.modelVersion] })] })) : (_jsx("p", { className: "text-sm text-slate-500", children: "\u5C1A\u672A\u57F7\u884C\u98A8\u96AA\u8A55\u4F30\uFF0C\u8ACB\u5148\u9001\u51FA\u7533\u8ACB\u3002" }))] }), _jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-4 text-sm font-semibold text-slate-700", children: "\u653E\u6B3E\u984D\u5EA6" }), limit ? (_jsxs(_Fragment, { children: [_jsxs("dl", { className: "grid grid-cols-2 gap-4", children: [_jsx(Field, { label: "\u6838\u5B9A\u4E0A\u9650", children: money(limit.maximumLimitCents / 100) }), _jsx(Field, { label: "\u76EE\u524D\u66DD\u96AA", children: money(limit.currentExposureCents / 100) }), _jsx(Field, { label: "\u53EF\u52D5\u7528\u984D\u5EA6", children: money(limit.availableLimitCents / 100) }), _jsx(Field, { label: "\u5EFA\u8B70\u91D1\u984D", children: _jsx("span", { className: "font-semibold text-brand-700", children: money(limit.recommendedAmountCents / 100) }) })] }), _jsx("div", { className: "mt-3", children: _jsx("span", { className: `inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${limit.decision === "LIMIT_AVAILABLE"
                                                        ? "bg-emerald-50 text-emerald-700"
                                                        : "bg-rose-50 text-rose-700"}`, children: limit.decision === "LIMIT_AVAILABLE" ? "額度足夠" : "超過額度" }) }), _jsx("ul", { className: "mt-3 list-inside list-disc space-y-1 text-xs text-slate-500", children: limitReasons.map((reason, index) => (_jsx("li", { children: reason }, index))) })] })) : (_jsx("p", { className: "text-sm text-slate-500", children: "\u5C1A\u672A\u8A08\u7B97\u984D\u5EA6\u3002" }))] }), _jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-4 text-sm font-semibold text-slate-700", children: "\u653E\u6B3E\u689D\u4EF6\uFF08\u5B9A\u50F9\u7D50\u679C\uFF09" }), offer ? (_jsxs("dl", { className: "grid grid-cols-2 gap-4", children: [_jsx(Field, { label: "\u6838\u51C6\u91D1\u984D", children: money(offer.approvedAmountCents / 100) }), _jsx(Field, { label: "\u653E\u6B3E\u5229\u7387", children: percent(offer.ratePercent, offer.rateUnit) }), _jsxs(Field, { label: "\u671F\u6578", children: [offer.termMonths, " \u671F"] }), _jsx(Field, { label: "\u9084\u6B3E\u65B9\u5F0F", children: REPAYMENT_METHOD_LABELS[offer.repaymentMethod] ?? offer.repaymentMethod }), _jsx(Field, { label: "\u7E3D\u5229\u606F", children: money(offer.totalInterestCents / 100) }), _jsx(Field, { label: "\u8CBB\u7528", children: money(offer.feesCents / 100) }), _jsx("div", { className: "col-span-2 border-t border-slate-200 pt-3", children: _jsx(Field, { label: "\u7E3D\u61C9\u9084", children: _jsx("span", { className: "text-lg font-semibold", children: money(offer.totalPayableCents / 100) }) }) }), _jsxs("p", { className: "col-span-2 text-xs text-slate-400", children: ["\u5B9A\u50F9\u7248\u672C ", offer.pricingVersion] })] })) : (_jsx("p", { className: "text-sm text-slate-500", children: "\u5C1A\u672A\u7522\u751F\u653E\u6B3E\u689D\u4EF6\u3002" }))] }), approval && (_jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-3 text-sm font-semibold text-slate-700", children: "\u5BE9\u6838\u6C7A\u5B9A" }), _jsxs("dl", { className: "grid grid-cols-2 gap-4", children: [_jsx(Field, { label: "\u6C7A\u5B9A", children: approval.decision }), _jsx(Field, { label: "\u6838\u51C6\u91D1\u984D", children: money(approval.approvedAmountCents ? approval.approvedAmountCents / 100 : null) }), _jsx(Field, { label: "\u6642\u9593", children: dateTime(approval.approvedAt) }), _jsx("div", { className: "col-span-2", children: _jsx(Field, { label: "\u539F\u56E0", children: approval.reason ?? "—" }) })] })] }))] })] }), showReject && (_jsx("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4", children: _jsxs("div", { className: "w-full max-w-md rounded-2xl bg-white p-6", children: [_jsx("h2", { className: "text-lg font-semibold", children: "\u5A49\u62D2\u7533\u8ACB" }), _jsx("p", { className: "mt-1 text-sm text-slate-500", children: "\u5A49\u62D2\u539F\u56E0\u6703\u8A18\u9304\u65BC\u7A3D\u6838\u8ECC\u8DE1\uFF0C\u7121\u6CD5\u4E8B\u5F8C\u4FEE\u6539\u3002" }), _jsx("textarea", { className: "input mt-4", rows: 3, value: rejectReason, onChange: (e) => setRejectReason(e.target.value), placeholder: "\u8ACB\u8AAA\u660E\u5A49\u62D2\u539F\u56E0" }), _jsx(ErrorBanner, { error: rejectMutation.error }), _jsxs("div", { className: "mt-4 flex justify-end gap-2", children: [_jsx("button", { className: "btn-secondary", onClick: () => setShowReject(false), children: "\u53D6\u6D88" }), _jsx("button", { className: "btn-danger", onClick: () => rejectMutation.mutate(), disabled: !rejectReason.trim() || rejectMutation.isPending, children: "\u78BA\u8A8D\u5A49\u62D2" })] })] }) }))] }));
}
