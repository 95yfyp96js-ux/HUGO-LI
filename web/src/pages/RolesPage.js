import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ErrorBanner, Loading, PageHeader } from "../components/ui";
const PERMISSION_LABELS = {
    CUSTOMER_READ: "查看客戶",
    CUSTOMER_CREATE: "建立客戶",
    CUSTOMER_UPDATE: "修改客戶",
    APPLICATION_READ: "查看申請",
    APPLICATION_CREATE: "建立申請",
    APPLICATION_UPDATE: "修改申請",
    APPLICATION_APPROVE: "核准申請",
    APPLICATION_REJECT: "婉拒申請",
    LOAN_READ: "查看放款",
    LOAN_CREATE: "建立放款",
    LOAN_APPROVE: "核准放款",
    LOAN_DISBURSE: "撥款",
    LOAN_RENEW: "續借",
    LOAN_EXTEND: "展期",
    LOAN_SETTLE: "結清",
    PAYMENT_READ: "查看收款",
    PAYMENT_CREATE: "建立收款",
    PAYMENT_REVERSE: "沖銷收款",
    COLLECTION_READ: "查看催收",
    COLLECTION_UPDATE: "催收作業",
    PRODUCT_READ: "查看產品",
    PRODUCT_UPDATE: "修改產品",
    USER_MANAGE: "管理使用者",
    AUDIT_READ: "查看稽核紀錄",
};
export function RolesPage() {
    const { data, isLoading, error } = useQuery({
        queryKey: ["roles"],
        queryFn: () => api("/api/settings/roles"),
    });
    if (isLoading)
        return _jsx(Loading, {});
    if (error)
        return _jsx(ErrorBanner, { error: error });
    return (_jsxs("div", { children: [_jsx(PageHeader, { title: "\u89D2\u8272\u6B0A\u9650", subtitle: "\u524D\u7AEF\u50C5\u96B1\u85CF\u7121\u6B0A\u9650\u7684\u64CD\u4F5C\uFF0C\u5BE6\u969B\u6B0A\u9650\u7531\u5F8C\u7AEF\u5F37\u5236\u9A57\u8B49" }), _jsx("div", { className: "grid gap-4 lg:grid-cols-2", children: data?.items.map((role) => (_jsxs("div", { className: "card p-5", children: [_jsxs("div", { className: "mb-3 flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h2", { className: "font-semibold text-slate-900", children: role.name }), _jsx("p", { className: "font-mono text-xs text-slate-400", children: role.code })] }), _jsxs("span", { className: "text-xs text-slate-500", children: [role.permissions.length, " \u9805\u6B0A\u9650"] })] }), _jsx("div", { className: "flex flex-wrap gap-1.5", children: role.permissions.map((permission) => (_jsx("span", { className: "rounded bg-slate-100 px-2 py-1 text-xs text-slate-700", title: permission, children: PERMISSION_LABELS[permission] ?? permission }, permission))) })] }, role.id))) })] }));
}
