import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { percent, REPAYMENT_METHOD_LABELS } from "../lib/format";
import { DataTable, ErrorBanner, Loading, Money, PageHeader, StatusBadge } from "../components/ui";
export function ProductsPage() {
    const { data, isLoading, error } = useQuery({
        queryKey: ["products", "all"],
        queryFn: () => api("/api/products"),
    });
    return (_jsxs("div", { children: [_jsx(PageHeader, { title: "\u653E\u6B3E\u7522\u54C1", subtitle: "\u4FEE\u6539\u5229\u7387\u6216\u8CBB\u7528\u6703\u5EFA\u7ACB\u65B0\u7248\u672C\u4E26\u5C01\u5B58\u820A\u7248\u672C\uFF0C\u65E2\u6709\u653E\u6B3E\u689D\u4EF6\u4E0D\u53D7\u5F71\u97FF" }), _jsx(ErrorBanner, { error: error }), isLoading ? (_jsx(Loading, {})) : (_jsx(DataTable, { rows: data?.items ?? [], rowKey: (row) => row.id, empty: "\u5C1A\u7121\u7522\u54C1", columns: [
                    {
                        header: "產品",
                        cell: (row) => (_jsx(Link, { to: `/products/${row.id}`, className: "font-medium text-brand-600 hover:underline", children: row.name })),
                    },
                    { header: "代碼", cell: (row) => _jsx("span", { className: "tabular", children: row.productCode }) },
                    { header: "版本", cell: (row) => `v${row.version}` },
                    { header: "利率", cell: (row) => percent(row.ratePercent, row.rateUnit) },
                    {
                        header: "金額範圍",
                        cell: (row) => (_jsxs("span", { className: "tabular text-xs", children: [_jsx(Money, { value: row.minAmount }), " ~ ", _jsx(Money, { value: row.maxAmount })] })),
                    },
                    { header: "期數", cell: (row) => `${row.minTermMonths}~${row.maxTermMonths} 期` },
                    {
                        header: "還款方式",
                        cell: (row) => REPAYMENT_METHOD_LABELS[row.repaymentMethod] ?? row.repaymentMethod,
                    },
                    {
                        header: "狀態",
                        cell: (row) => (_jsx(StatusBadge, { status: row.status === "ARCHIVED" ? "CANCELLED" : row.status })),
                    },
                ] }))] }));
}
