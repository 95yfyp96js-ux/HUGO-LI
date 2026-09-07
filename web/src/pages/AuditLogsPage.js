import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { dateTime } from "../lib/format";
import { DataTable, ErrorBanner, Loading, PageHeader } from "../components/ui";
const ACTION_LABELS = {
    CUSTOMER_CREATED: "建立客戶",
    CUSTOMER_UPDATED: "修改客戶",
    APPLICATION_CREATED: "建立申請",
    APPLICATION_SUBMITTED: "送出申請",
    APPLICATION_APPROVED: "核准申請",
    APPLICATION_REJECTED: "婉拒申請",
    RISK_ASSESSMENT_CREATED: "風險評估",
    LENDING_LIMIT_CALCULATED: "額度計算",
    LOAN_OFFER_CREATED: "產生放款條件",
    LOAN_CREATED: "建立放款",
    LOAN_DISBURSED: "撥款",
    PAYMENT_CREATED: "收款",
    PAYMENT_REVERSED: "沖銷收款",
    SETTLEMENT_CREATED: "結清",
    RENEWAL_CREATED: "續借",
    EXTENSION_CREATED: "展期",
    COLLECTION_CASE_CREATED: "建立催收案件",
    COLLECTION_ACTIVITY_CREATED: "催收紀錄",
    PROMISE_TO_PAY_CREATED: "還款承諾",
    PRODUCT_CREATED: "建立產品",
    PRODUCT_UPDATED: "修改產品",
};
export function AuditLogsPage() {
    const [resource, setResource] = useState("");
    const [expanded, setExpanded] = useState(null);
    const { data, isLoading, error } = useQuery({
        queryKey: ["audit-logs", resource],
        queryFn: () => api("/api/audit-logs", { query: { resource, take: 100 } }),
    });
    const resources = ["", "Customer", "LendingApplication", "Loan", "Payment", "LoanProduct", "CollectionCase"];
    return (_jsxs("div", { children: [_jsx(PageHeader, { title: "\u64CD\u4F5C\u7D00\u9304", subtitle: data
                    ? `共 ${data.total} 筆稽核紀錄。稽核紀錄僅供追加，任何使用者皆無法刪除。`
                    : undefined }), _jsx("div", { className: "mb-4 flex flex-wrap gap-2", children: resources.map((item) => (_jsx("button", { onClick: () => setResource(item), className: `rounded-full px-3 py-1.5 text-sm font-medium transition ${resource === item
                        ? "bg-brand-600 text-white"
                        : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`, children: item || "全部" }, item || "all"))) }), _jsx(ErrorBanner, { error: error }), isLoading ? (_jsx(Loading, {})) : (_jsx(DataTable, { rows: data?.items ?? [], rowKey: (row) => row.id, empty: "\u5C1A\u7121\u7A3D\u6838\u7D00\u9304", columns: [
                    { header: "時間", cell: (row) => dateTime(row.timestamp) },
                    { header: "操作人", cell: (row) => row.user?.displayName ?? "系統" },
                    {
                        header: "操作",
                        cell: (row) => (_jsx("span", { className: "font-medium", children: ACTION_LABELS[row.action] ?? row.action })),
                    },
                    { header: "對象", cell: (row) => _jsx("span", { className: "text-xs text-slate-500", children: row.resource }) },
                    { header: "原因", cell: (row) => row.reason ?? "—" },
                    { header: "IP", cell: (row) => _jsx("span", { className: "tabular text-xs", children: row.ip ?? "—" }) },
                    {
                        header: "內容",
                        cell: (row) => (_jsx("button", { className: "text-xs text-brand-600 hover:underline", onClick: () => setExpanded(expanded === row.id ? null : row.id), children: expanded === row.id ? "收合" : "展開" })),
                    },
                ] })), expanded && (_jsxs("div", { className: "card mt-4 p-5", children: [_jsx("h2", { className: "mb-3 text-sm font-semibold text-slate-700", children: "\u8B8A\u66F4\u5167\u5BB9" }), (() => {
                        const row = data?.items.find((item) => item.id === expanded);
                        if (!row)
                            return null;
                        return (_jsxs("div", { className: "grid gap-4 lg:grid-cols-2", children: [_jsxs("div", { children: [_jsx("div", { className: "mb-1 text-xs font-medium text-slate-500", children: "\u8B8A\u66F4\u524D" }), _jsx("pre", { className: "overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs", children: row.before ? JSON.stringify(JSON.parse(row.before), null, 2) : "—" })] }), _jsxs("div", { children: [_jsx("div", { className: "mb-1 text-xs font-medium text-slate-500", children: "\u8B8A\u66F4\u5F8C" }), _jsx("pre", { className: "overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs", children: row.after ? JSON.stringify(JSON.parse(row.after), null, 2) : "—" })] })] }));
                    })()] }))] }));
}
