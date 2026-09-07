import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { date } from "../lib/format";
import { DataTable, ErrorBanner, Loading, Money, PageHeader, StatusBadge } from "../components/ui";
import { useAuth } from "../lib/auth";
export function CustomersPage() {
    const { can } = useAuth();
    const [query, setQuery] = useState("");
    const [search, setSearch] = useState("");
    const { data, isLoading, error } = useQuery({
        queryKey: ["customers", search],
        queryFn: () => api("/api/customers", { query: { q: search, take: 50 } }),
    });
    return (_jsxs("div", { children: [_jsx(PageHeader, { title: "\u5BA2\u6236", subtitle: data ? `共 ${data.total} 位客戶` : undefined, actions: can("CUSTOMER_CREATE") && (_jsx(Link, { to: "/customers/new", className: "btn-primary", children: "\u65B0\u589E\u5BA2\u6236" })) }), _jsxs("form", { className: "mb-4 flex gap-2", onSubmit: (e) => {
                    e.preventDefault();
                    setSearch(query);
                }, children: [_jsx("input", { className: "input max-w-md", placeholder: "\u641C\u5C0B\u59D3\u540D\u3001\u5BA2\u6236\u7DE8\u865F\u3001\u96FB\u8A71\u3001\u8EAB\u5206\u8B49\u5B57\u865F\u6216\u653E\u6B3E\u7DE8\u865F", value: query, onChange: (e) => setQuery(e.target.value) }), _jsx("button", { type: "submit", className: "btn-secondary", children: "\u641C\u5C0B" })] }), _jsx(ErrorBanner, { error: error }), isLoading ? (_jsx(Loading, {})) : (_jsx(DataTable, { rows: data?.items ?? [], rowKey: (row) => row.id, empty: "\u627E\u4E0D\u5230\u7B26\u5408\u689D\u4EF6\u7684\u5BA2\u6236", columns: [
                    {
                        header: "客戶編號",
                        cell: (row) => (_jsx(Link, { to: `/customers/${row.id}`, className: "font-medium text-brand-600 hover:underline", children: row.customerNumber })),
                    },
                    { header: "姓名", cell: (row) => _jsx("span", { className: "font-medium", children: row.name }) },
                    { header: "身分證字號", cell: (row) => _jsx("span", { className: "tabular text-slate-500", children: row.identityNumber }) },
                    { header: "電話", cell: (row) => _jsx("span", { className: "tabular", children: row.phone }) },
                    { header: "狀態", cell: (row) => _jsx(StatusBadge, { status: row.status }) },
                    { header: "活躍放款", cell: (row) => `${row.activeLoanCount} 件` },
                    {
                        header: "目前欠款",
                        cell: (row) => _jsx(Money, { value: row.totalOutstanding, className: "font-medium" }),
                        className: "text-right",
                    },
                    { header: "建檔日", cell: (row) => date(row.createdAt) },
                ] }))] }));
}
