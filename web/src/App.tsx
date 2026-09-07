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

  if (loading) return <Loading label="載入中…" />;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/dashboard" replace />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/quick-actions" element={<QuickActionsPage />} />

        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/customers/new" element={<NewCustomerPage />} />
        <Route path="/customers/:id" element={<CustomerDetailPage />} />

        <Route path="/lending/applications" element={<ApplicationsPage />} />
        <Route path="/lending/applications/new" element={<NewApplicationPage />} />
        <Route path="/lending/applications/:id" element={<ApplicationDetailPage />} />

        {/* Static loan routes must precede /loans/:id */}
        <Route path="/loans" element={<LoansPage />} />
        <Route path="/loans/new" element={<NewLoanPage />} />
        <Route path="/loans/pending-disbursement" element={<PendingDisbursementPage />} />
        <Route path="/loans/overdue" element={<OverdueLoansPage />} />
        <Route path="/loans/:id" element={<LoanDetailPage />} />

        <Route path="/payments" element={<PaymentsPage />} />
        <Route path="/payments/new" element={<NewPaymentPage />} />

        <Route path="/collections" element={<CollectionsPage />} />
        <Route path="/collections/:id" element={<CollectionDetailPage />} />

        <Route path="/renewals" element={<RenewalsPage />} />

        <Route path="/products" element={<ProductsPage />} />
        <Route path="/products/:id" element={<ProductDetailPage />} />

        <Route path="/reports" element={<ReportsPage />} />

        <Route path="/settings/users" element={<UsersPage />} />
        <Route path="/settings/roles" element={<RolesPage />} />
        <Route path="/settings/audit-logs" element={<AuditLogsPage />} />

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
