import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
const NAV_SECTIONS = [
    {
        title: "營運",
        items: [
            { to: "/dashboard", label: "營運總覽", icon: "▤", permission: "LOAN_READ" },
            { to: "/quick-actions", label: "快速作業", icon: "⚡" },
        ],
    },
    {
        title: "放款",
        items: [
            { to: "/customers", label: "客戶", icon: "👤", permission: "CUSTOMER_READ" },
            { to: "/lending/applications", label: "放款申請", icon: "📄", permission: "APPLICATION_READ" },
            { to: "/loans", label: "放款帳戶", icon: "💰", permission: "LOAN_READ" },
            { to: "/loans/pending-disbursement", label: "待撥款", icon: "🏦", permission: "LOAN_READ" },
            { to: "/loans/overdue", label: "逾期管理", icon: "⚠️", permission: "LOAN_READ" },
        ],
    },
    {
        title: "帳務",
        items: [
            { to: "/payments", label: "收款紀錄", icon: "🧾", permission: "PAYMENT_READ" },
            { to: "/collections", label: "催收", icon: "📞", permission: "COLLECTION_READ" },
            { to: "/renewals", label: "續借紀錄", icon: "🔁", permission: "LOAN_READ" },
            { to: "/reports", label: "報表", icon: "📊", permission: "LOAN_READ" },
        ],
    },
    {
        title: "設定",
        items: [
            { to: "/products", label: "放款產品", icon: "📦", permission: "PRODUCT_READ" },
            { to: "/settings/users", label: "使用者", icon: "🔑", permission: "USER_MANAGE" },
            { to: "/settings/roles", label: "角色權限", icon: "🛡", permission: "USER_MANAGE" },
            { to: "/settings/audit-logs", label: "操作紀錄", icon: "📋", permission: "AUDIT_READ" },
        ],
    },
];
// The four operations that matter on a phone (§44).
const MOBILE_NAV = [
    { to: "/dashboard", label: "總覽", icon: "▤" },
    { to: "/loans", label: "放款", icon: "💰" },
    { to: "/quick-actions", label: "快速", icon: "⚡" },
    { to: "/collections", label: "催收", icon: "📞" },
];
export function Layout() {
    const { user, logout, can } = useAuth();
    const [menuOpen, setMenuOpen] = useState(false);
    const location = useLocation();
    const visible = (item) => !item.permission || can(item.permission);
    return (_jsxs("div", { className: "min-h-screen lg:flex", children: [_jsxs("aside", { className: "hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block", children: [_jsx("div", { className: "flex h-16 items-center gap-2 border-b border-slate-200 px-5", children: _jsx("span", { className: "text-lg font-bold text-brand-700", children: "Small Lending OS" }) }), _jsx("nav", { className: "space-y-6 p-4", children: NAV_SECTIONS.map((section) => {
                            const items = section.items.filter(visible);
                            if (items.length === 0)
                                return null;
                            return (_jsxs("div", { children: [_jsx("div", { className: "mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400", children: section.title }), _jsx("div", { className: "space-y-0.5", children: items.map((item) => (_jsxs(NavLink, { to: item.to, end: item.to === "/loans", className: ({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${isActive
                                                ? "bg-brand-50 text-brand-700"
                                                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`, children: [_jsx("span", { className: "w-5 text-center", children: item.icon }), item.label] }, item.to))) })] }, section.title));
                        }) })] }), _jsxs("div", { className: "flex min-w-0 flex-1 flex-col", children: [_jsxs("header", { className: "sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-8", children: [_jsx("button", { className: "rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden", onClick: () => setMenuOpen((open) => !open), "aria-label": "\u958B\u555F\u9078\u55AE", children: "\u2630" }), _jsx("span", { className: "font-semibold text-brand-700 lg:hidden", children: "Small Lending OS" }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("div", { className: "hidden text-right sm:block", children: [_jsx("div", { className: "text-sm font-medium text-slate-900", children: user?.displayName }), _jsx("div", { className: "text-xs text-slate-500", children: user?.roles.join(", ") })] }), _jsx("button", { onClick: logout, className: "btn-secondary text-xs", children: "\u767B\u51FA" })] })] }), menuOpen && (_jsx("div", { className: "border-b border-slate-200 bg-white p-4 lg:hidden", children: NAV_SECTIONS.flatMap((section) => section.items)
                            .filter(visible)
                            .map((item) => (_jsxs(NavLink, { to: item.to, onClick: () => setMenuOpen(false), className: ({ isActive }) => `touch-target flex items-center gap-3 rounded-lg px-3 text-sm font-medium ${isActive ? "bg-brand-50 text-brand-700" : "text-slate-700"}`, children: [_jsx("span", { className: "w-5 text-center", children: item.icon }), item.label] }, item.to))) })), _jsx("main", { className: "flex-1 p-4 pb-24 lg:p-8 lg:pb-8", children: _jsx(Outlet, {}, location.pathname) }), _jsx("nav", { className: "fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden", children: MOBILE_NAV.map((item) => (_jsxs(NavLink, { to: item.to, end: item.to === "/loans", className: ({ isActive }) => `touch-target flex flex-col items-center justify-center gap-1 text-xs font-medium ${isActive ? "text-brand-700" : "text-slate-500"}`, children: [_jsx("span", { className: "text-lg", children: item.icon }), item.label] }, item.to))) })] })] }));
}
