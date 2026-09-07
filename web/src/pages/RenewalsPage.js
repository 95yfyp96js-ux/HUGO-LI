import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { date } from "../lib/format";
import { DataTable, ErrorBanner, Loading, Money, PageHeader, StatusBadge } from "../components/ui";
export function RenewalsPage() {
    const { data, isLoading, error } = useQuery({
        queryKey: ["renewals"],
        queryFn: () => api("/api/renewals", { query: { take: 50 } }),
    });
    return (_jsxs("div", { children: [_jsx(PageHeader, { title: "\u7E8C\u501F\u7D00\u9304", subtitle: data
                    ? `共 ${data.total} 筆續借。續借會建立新放款並保留原放款完整歷史。`
                    : undefined }), _jsx(ErrorBanner, { error: error }), isLoading ? (_jsx(Loading, {})) : (_jsx(DataTable, { rows: data?.items ?? [], rowKey: (row) => row.id, empty: "\u5C1A\u7121\u7E8C\u501F\u7D00\u9304", columns: [
                    {
                        header: "客戶",
                        cell: (row) => (_jsx(Link, { to: `/customers/${row.previousLoan.customer.id}`, className: "hover:underline", children: row.previousLoan.customer.name })),
                    },
                    {
                        header: "原放款",
                        cell: (row) => (_jsx(Link, { to: `/loans/${row.previousLoan.id}`, className: "text-brand-600 hover:underline", children: row.previousLoan.loanNumber })),
                    },
                    { header: "", cell: () => _jsx("span", { className: "text-slate-400", children: "\u2192" }) },
                    {
                        header: "新放款",
                        cell: (row) => (_jsx(Link, { to: `/loans/${row.newLoan.id}`, className: "font-medium text-brand-600 hover:underline", children: row.newLoan.loanNumber })),
                    },
                    {
                        header: "新放款金額",
                        cell: (row) => _jsx(Money, { value: row.newLoan.principalCents / 100, className: "font-medium" }),
                        className: "text-right",
                    },
                    { header: "狀態", cell: (row) => _jsx(StatusBadge, { status: row.newLoan.status }) },
                    { header: "續借原因", cell: (row) => _jsx("span", { className: "text-slate-600", children: row.reason }) },
                    { header: "續借日", cell: (row) => date(row.createdAt) },
                ] }))] }));
}
