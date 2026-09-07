import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { date } from "../lib/format";
import { DataTable, ErrorBanner, Loading, Money, PageHeader, RiskGradeBadge, StatusBadge, } from "../components/ui";
import { useAuth } from "../lib/auth";
export function OverdueLoansPage() {
    const { can } = useAuth();
    const queryClient = useQueryClient();
    const { data, isLoading, error } = useQuery({
        queryKey: ["loans", "overdue"],
        queryFn: () => api("/api/loans", { query: { overdue: true, take: 100 } }),
    });
    // Opening cases is a server-side sweep driven by the OverdueEngine.
    const syncMutation = useMutation({
        mutationFn: () => api("/api/collections/sync", { method: "POST" }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["collections"] });
            queryClient.invalidateQueries({ queryKey: ["loans"] });
        },
    });
    return (_jsxs("div", { children: [_jsx(PageHeader, { title: "\u903E\u671F\u7BA1\u7406", subtitle: data ? `共 ${data.total} 筆逾期放款` : undefined, actions: can("COLLECTION_UPDATE") && (_jsx("button", { className: "btn-primary", onClick: () => syncMutation.mutate(), disabled: syncMutation.isPending, children: syncMutation.isPending ? "建立中…" : "建立催收案件" })) }), _jsx(ErrorBanner, { error: error ?? syncMutation.error }), syncMutation.isSuccess && (_jsxs("div", { className: "mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800", children: ["\u5DF2\u5EFA\u7ACB ", syncMutation.data.openedCaseIds.length, " \u4EF6\u65B0\u50AC\u6536\u6848\u4EF6\u3002", _jsx(Link, { to: "/collections", className: "ml-2 font-medium underline", children: "\u524D\u5F80\u50AC\u6536" })] })), isLoading ? (_jsx(Loading, {})) : (_jsx(DataTable, { rows: data?.items ?? [], rowKey: (row) => row.id, empty: "\u76EE\u524D\u6C92\u6709\u903E\u671F\u653E\u6B3E", columns: [
                    {
                        header: "放款編號",
                        cell: (row) => (_jsx(Link, { to: `/loans/${row.id}`, className: "font-medium text-brand-600 hover:underline", children: row.loanNumber })),
                    },
                    {
                        header: "客戶",
                        cell: (row) => (_jsx(Link, { to: `/customers/${row.customer.id}`, className: "hover:underline", children: row.customer.name })),
                    },
                    { header: "風險", cell: (row) => _jsx(RiskGradeBadge, { grade: row.riskGrade }) },
                    { header: "狀態", cell: (row) => _jsx(StatusBadge, { status: row.status }) },
                    {
                        header: "逾期天數",
                        cell: (row) => _jsx("span", { className: "tabular font-semibold text-rose-600", children: row.daysOverdue }),
                    },
                    {
                        header: "逾期金額",
                        cell: (row) => _jsx(Money, { value: row.overdueAmount, className: "font-medium text-rose-600" }),
                        className: "text-right",
                    },
                    { header: "總欠款", cell: (row) => _jsx(Money, { value: row.totalOutstanding }), className: "text-right" },
                    { header: "到期日", cell: (row) => date(row.maturityDate) },
                    {
                        header: "操作",
                        cell: (row) => (_jsxs("div", { className: "flex gap-2", children: [_jsx(Link, { to: `/payments/new?loanId=${row.id}`, className: "text-brand-600 hover:underline", children: "\u6536\u6B3E" }), _jsx(Link, { to: `/loans/${row.id}`, className: "text-slate-500 hover:underline", children: "\u660E\u7D30" })] })),
                    },
                ] }))] }));
}
