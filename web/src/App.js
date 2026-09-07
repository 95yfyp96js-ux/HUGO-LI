import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { Layout } from "./components/Layout";
import { Loading } from "./components/ui";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { CustomersPage } from "./pages/CustomersPage";
import { NewCustomerPage } from "./pages/NewCustomerPage";
import { CustomerDetailPage } from "./pages/CustomerDetailPage";
import { ApplicationsPage } from "./pages/ApplicationsPage";
import { NewApplicationPage } from "./pages/NewApplicationPage";
import { ApplicationDetailPage } from "./pages/ApplicationDetailPage";
import { LoansPage } from "./pages/LoansPage";
import { NewLoanPage } from "./pages/NewLoanPage";
import { LoanDetailPage } from "./pages/LoanDetailPage";
import { PendingDisbursementPage } from "./pages/PendingDisbursementPage";
import { OverdueLoansPage } from "./pages/OverdueLoansPage";
import { PaymentsPage } from "./pages/PaymentsPage";
import { NewPaymentPage } from "./pages/NewPaymentPage";
import { CollectionsPage } from "./pages/CollectionsPage";
import { CollectionDetailPage } from "./pages/CollectionDetailPage";
import { RenewalsPage } from "./pages/RenewalsPage";
import { ProductsPage } from "./pages/ProductsPage";
import { ProductDetailPage } from "./pages/ProductDetailPage";
import { ReportsPage } from "./pages/ReportsPage";
import { UsersPage } from "./pages/UsersPage";
import { RolesPage } from "./pages/RolesPage";
import { AuditLogsPage } from "./pages/AuditLogsPage";
import { QuickActionsPage } from "./pages/QuickActionsPage";
export function App() {
    const { user, loading } = useAuth();
    if (loading)
        return _jsx(Loading, { label: "\u8F09\u5165\u4E2D\u2026" });
    if (!user) {
        return (_jsxs(Routes, { children: [_jsx(Route, { path: "/login", element: _jsx(LoginPage, {}) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/login", replace: true }) })] }));
    }
    return (_jsxs(Routes, { children: [_jsx(Route, { path: "/login", element: _jsx(Navigate, { to: "/dashboard", replace: true }) }), _jsxs(Route, { element: _jsx(Layout, {}), children: [_jsx(Route, { path: "/", element: _jsx(Navigate, { to: "/dashboard", replace: true }) }), _jsx(Route, { path: "/dashboard", element: _jsx(DashboardPage, {}) }), _jsx(Route, { path: "/quick-actions", element: _jsx(QuickActionsPage, {}) }), _jsx(Route, { path: "/customers", element: _jsx(CustomersPage, {}) }), _jsx(Route, { path: "/customers/new", element: _jsx(NewCustomerPage, {}) }), _jsx(Route, { path: "/customers/:id", element: _jsx(CustomerDetailPage, {}) }), _jsx(Route, { path: "/lending/applications", element: _jsx(ApplicationsPage, {}) }), _jsx(Route, { path: "/lending/applications/new", element: _jsx(NewApplicationPage, {}) }), _jsx(Route, { path: "/lending/applications/:id", element: _jsx(ApplicationDetailPage, {}) }), _jsx(Route, { path: "/loans", element: _jsx(LoansPage, {}) }), _jsx(Route, { path: "/loans/new", element: _jsx(NewLoanPage, {}) }), _jsx(Route, { path: "/loans/pending-disbursement", element: _jsx(PendingDisbursementPage, {}) }), _jsx(Route, { path: "/loans/overdue", element: _jsx(OverdueLoansPage, {}) }), _jsx(Route, { path: "/loans/:id", element: _jsx(LoanDetailPage, {}) }), _jsx(Route, { path: "/payments", element: _jsx(PaymentsPage, {}) }), _jsx(Route, { path: "/payments/new", element: _jsx(NewPaymentPage, {}) }), _jsx(Route, { path: "/collections", element: _jsx(CollectionsPage, {}) }), _jsx(Route, { path: "/collections/:id", element: _jsx(CollectionDetailPage, {}) }), _jsx(Route, { path: "/renewals", element: _jsx(RenewalsPage, {}) }), _jsx(Route, { path: "/products", element: _jsx(ProductsPage, {}) }), _jsx(Route, { path: "/products/:id", element: _jsx(ProductDetailPage, {}) }), _jsx(Route, { path: "/reports", element: _jsx(ReportsPage, {}) }), _jsx(Route, { path: "/settings/users", element: _jsx(UsersPage, {}) }), _jsx(Route, { path: "/settings/roles", element: _jsx(RolesPage, {}) }), _jsx(Route, { path: "/settings/audit-logs", element: _jsx(AuditLogsPage, {}) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/dashboard", replace: true }) })] })] }));
}
