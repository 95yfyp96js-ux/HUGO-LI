import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { date, dateTime, money } from "../lib/format";
import { ErrorBanner, Field, Loading, PageHeader, StatusBadge } from "../components/ui";
import { useAuth } from "../lib/auth";
const ACTIVITY_LABELS = {
    PHONE: "電話",
    SMS: "簡訊",
    EMAIL: "電子郵件",
    IN_PERSON: "當面拜訪",
    SYSTEM: "系統",
    OTHER: "其他",
};
export function CollectionDetailPage() {
    const { id } = useParams();
    const { can } = useAuth();
    const queryClient = useQueryClient();
    const [activity, setActivity] = useState({ type: "PHONE", result: "", note: "", nextActionAt: "" });
    const [promise, setPromise] = useState({ amount: "", promisedDate: "" });
    const { data, isLoading, error } = useQuery({
        queryKey: ["collection", id],
        queryFn: () => api(`/api/collections/${id}`),
    });
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ["collection", id] });
    const activityMutation = useMutation({
        mutationFn: () => api(`/api/collections/${id}/activity`, {
            method: "POST",
            body: {
                type: activity.type,
                result: activity.result || null,
                note: activity.note || null,
                nextActionAt: activity.nextActionAt || undefined,
            },
        }),
        onSuccess: () => {
            setActivity({ type: "PHONE", result: "", note: "", nextActionAt: "" });
            invalidate();
        },
    });
    const promiseMutation = useMutation({
        mutationFn: () => api(`/api/collections/${id}/promise`, {
            method: "POST",
            body: { amount: promise.amount, promisedDate: promise.promisedDate },
        }),
        onSuccess: () => {
            setPromise({ amount: "", promisedDate: "" });
            invalidate();
        },
    });
    if (isLoading)
        return _jsx(Loading, {});
    if (error)
        return _jsx(ErrorBanner, { error: error });
    if (!data)
        return null;
    return (_jsxs("div", { children: [_jsx(PageHeader, { title: data.caseNumber, subtitle: `${data.customer.name}（${data.customer.customerNumber}）・ ${data.customer.phone}`, actions: _jsxs(_Fragment, { children: [_jsx(Link, { to: `/payments/new?loanId=${data.loan.id}`, className: "btn-primary", children: "\u6536\u6B3E" }), _jsx(Link, { to: `/loans/${data.loan.id}`, className: "btn-secondary", children: "\u653E\u6B3E\u660E\u7D30" })] }) }), _jsxs("div", { className: "mb-6 grid gap-4 lg:grid-cols-3", children: [_jsxs("div", { className: "card p-5 lg:col-span-1", children: [_jsx("h2", { className: "mb-4 text-sm font-semibold text-slate-700", children: "\u6848\u4EF6\u8CC7\u8A0A" }), _jsxs("dl", { className: "grid grid-cols-2 gap-4", children: [_jsx(Field, { label: "\u72C0\u614B", children: _jsx(StatusBadge, { status: data.status, kind: "collection" }) }), _jsx(Field, { label: "\u512A\u5148\u5EA6", children: _jsx(StatusBadge, { status: data.priority, kind: "priority" }) }), _jsx(Field, { label: "\u903E\u671F\u5929\u6578", children: _jsxs("span", { className: "text-rose-600", children: [data.daysOverdue, " \u5929"] }) }), _jsx(Field, { label: "\u6B20\u6B3E", children: money(data.outstandingAmountCents / 100) }), _jsx(Field, { label: "\u653E\u6B3E\u7DE8\u865F", children: _jsx(Link, { to: `/loans/${data.loan.id}`, className: "text-brand-600 hover:underline", children: data.loan.loanNumber }) }), _jsx(Field, { label: "\u5230\u671F\u65E5", children: date(data.loan.maturityDate) }), _jsx(Field, { label: "\u8CA0\u8CAC\u4EBA", children: data.assignedUser?.displayName ?? "未指派" }), _jsx(Field, { label: "\u4E0B\u6B21\u8FFD\u8E64", children: date(data.nextActionAt) })] })] }), _jsxs("div", { className: "space-y-4 lg:col-span-2", children: [can("COLLECTION_UPDATE") && (_jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-4 text-sm font-semibold text-slate-700", children: "\u65B0\u589E\u50AC\u6536\u7D00\u9304" }), _jsxs("div", { className: "grid gap-3 sm:grid-cols-2", children: [_jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "coll-f1", children: "\u806F\u7E6B\u65B9\u5F0F" }), _jsx("select", { id: "coll-f1", className: "input", value: activity.type, onChange: (e) => setActivity((a) => ({ ...a, type: e.target.value })), children: Object.entries(ACTIVITY_LABELS).map(([value, label]) => (_jsx("option", { value: value, children: label }, value))) })] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "coll-f2", children: "\u7D50\u679C" }), _jsx("input", { id: "coll-f2", className: "input", value: activity.result, onChange: (e) => setActivity((a) => ({ ...a, result: e.target.value })), placeholder: "\u4F8B\uFF1A\u5BA2\u6236\u627F\u8AFE 9/10 \u9084\u6B3E" })] }), _jsxs("div", { className: "sm:col-span-2", children: [_jsx("label", { className: "label", htmlFor: "coll-f3", children: "\u5099\u8A3B" }), _jsx("textarea", { id: "coll-f3", className: "input", rows: 2, value: activity.note, onChange: (e) => setActivity((a) => ({ ...a, note: e.target.value })) })] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "coll-f4", children: "\u4E0B\u6B21\u8FFD\u8E64\u65E5" }), _jsx("input", { id: "coll-f4", type: "date", className: "input", value: activity.nextActionAt, onChange: (e) => setActivity((a) => ({ ...a, nextActionAt: e.target.value })) })] })] }), _jsx(ErrorBanner, { error: activityMutation.error }), _jsx("div", { className: "mt-4 flex justify-end", children: _jsx("button", { className: "btn-primary", onClick: () => activityMutation.mutate(), disabled: activityMutation.isPending, children: activityMutation.isPending ? "儲存中…" : "新增紀錄" }) })] })), can("COLLECTION_UPDATE") && (_jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-4 text-sm font-semibold text-slate-700", children: "\u5EFA\u7ACB\u9084\u6B3E\u627F\u8AFE" }), _jsxs("div", { className: "grid gap-3 sm:grid-cols-2", children: [_jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "coll-f5", children: "\u627F\u8AFE\u91D1\u984D" }), _jsx("input", { id: "coll-f5", className: "input tabular", inputMode: "decimal", value: promise.amount, onChange: (e) => setPromise((p) => ({ ...p, amount: e.target.value })) })] }), _jsxs("div", { children: [_jsx("label", { className: "label", htmlFor: "coll-f6", children: "\u627F\u8AFE\u65E5\u671F" }), _jsx("input", { id: "coll-f6", type: "date", className: "input", value: promise.promisedDate, onChange: (e) => setPromise((p) => ({ ...p, promisedDate: e.target.value })) })] })] }), _jsx(ErrorBanner, { error: promiseMutation.error }), _jsx("div", { className: "mt-4 flex justify-end", children: _jsx("button", { className: "btn-secondary", onClick: () => promiseMutation.mutate(), disabled: promiseMutation.isPending || !promise.amount || !promise.promisedDate, children: "\u5EFA\u7ACB\u627F\u8AFE" }) })] }))] })] }), _jsxs("div", { className: "grid gap-4 lg:grid-cols-2", children: [_jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-4 text-sm font-semibold text-slate-700", children: "\u50AC\u6536\u7D00\u9304" }), data.activities.length === 0 ? (_jsx("p", { className: "text-sm text-slate-500", children: "\u5C1A\u7121\u50AC\u6536\u7D00\u9304" })) : (_jsx("ol", { className: "space-y-3", children: data.activities.map((item) => (_jsxs("li", { className: "border-l-2 border-brand-200 pl-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-sm font-medium", children: ACTIVITY_LABELS[item.type] ?? item.type }), _jsx("span", { className: "text-xs text-slate-400", children: dateTime(item.createdAt) })] }), item.result && _jsx("div", { className: "mt-0.5 text-sm text-slate-700", children: item.result }), item.note && _jsx("div", { className: "mt-0.5 text-xs text-slate-500", children: item.note }), item.nextActionAt && (_jsxs("div", { className: "mt-1 text-xs text-brand-600", children: ["\u4E0B\u6B21\u8FFD\u8E64\uFF1A", date(item.nextActionAt)] }))] }, item.id))) }))] }), _jsxs("div", { className: "card p-5", children: [_jsx("h2", { className: "mb-4 text-sm font-semibold text-slate-700", children: "\u9084\u6B3E\u627F\u8AFE" }), data.promises.length === 0 ? (_jsx("p", { className: "text-sm text-slate-500", children: "\u5C1A\u7121\u9084\u6B3E\u627F\u8AFE" })) : (_jsx("ul", { className: "space-y-2", children: data.promises.map((p) => (_jsxs("li", { className: "flex items-center justify-between rounded-lg border border-slate-200 p-3", children: [_jsxs("div", { children: [_jsx("div", { className: "tabular text-sm font-medium", children: money(p.promisedAmountCents / 100) }), _jsxs("div", { className: "text-xs text-slate-500", children: ["\u627F\u8AFE\u65E5\u671F ", date(p.promisedDate)] })] }), _jsx(StatusBadge, { status: p.status === "PENDING" ? "PROMISE_TO_PAY" : p.status, kind: "collection" })] }, p.id))) }))] })] })] }));
}
