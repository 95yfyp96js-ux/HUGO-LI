import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { date } from "../lib/format";
import { DataTable, ErrorBanner, Loading, PageHeader, StatusBadge } from "../components/ui";
export function UsersPage() {
    const { data, isLoading, error } = useQuery({
        queryKey: ["users"],
        queryFn: () => api("/api/settings/users"),
    });
    return (_jsxs("div", { children: [_jsx(PageHeader, { title: "\u4F7F\u7528\u8005", subtitle: "\u4F7F\u7528\u8005\u6B0A\u9650\u7531\u89D2\u8272\u6C7A\u5B9A\uFF0C\u5F8C\u7AEF\u6BCF\u6B21\u8ACB\u6C42\u90FD\u6703\u91CD\u65B0\u9A57\u8B49" }), _jsx(ErrorBanner, { error: error }), isLoading ? (_jsx(Loading, {})) : (_jsx(DataTable, { rows: data?.items ?? [], rowKey: (row) => row.id, empty: "\u5C1A\u7121\u4F7F\u7528\u8005", columns: [
                    { header: "姓名", cell: (row) => _jsx("span", { className: "font-medium", children: row.displayName }) },
                    { header: "電子郵件", cell: (row) => row.email },
                    {
                        header: "角色",
                        cell: (row) => (_jsx("div", { className: "flex flex-wrap gap-1", children: row.roles.map((role) => (_jsx("span", { className: "rounded bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700", children: role }, role))) })),
                    },
                    { header: "狀態", cell: (row) => _jsx(StatusBadge, { status: row.status }) },
                    { header: "建立日期", cell: (row) => date(row.createdAt) },
                ] }))] }));
}
