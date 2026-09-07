import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { date } from "../lib/format";
import {
  DataTable,
  ErrorBanner,
  Loading,
  Money,
  PageHeader,
  RiskGradeBadge,
  StatusBadge,
} from "../components/ui";
import { useAuth } from "../lib/auth";
import type { LoanRow } from "./LoansPage";

export function OverdueLoansPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["loans", "overdue"],
    queryFn: () => api<{ items: LoanRow[]; total: number }>("/api/loans", { query: { overdue: true, take: 100 } }),
  });

  // Opening cases is a server-side sweep driven by the OverdueEngine.
  const syncMutation = useMutation({
    mutationFn: () => api<{ openedCaseIds: string[] }>("/api/collections/sync", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({ queryKey: ["loans"] });
    },
  });

  return (
    <div>
      <PageHeader
        title="逾期管理"
        subtitle={data ? `共 ${data.total} 筆逾期放款` : undefined}
        actions={
          can("COLLECTION_UPDATE") && (
            <button
              className="btn-primary"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              {syncMutation.isPending ? "建立中…" : "建立催收案件"}
            </button>
          )
        }
      />

      <ErrorBanner error={error ?? syncMutation.error} />
      {syncMutation.isSuccess && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          已建立 {syncMutation.data.openedCaseIds.length} 件新催收案件。
          <Link to="/collections" className="ml-2 font-medium underline">
            前往催收
          </Link>
        </div>
      )}

      {isLoading ? (
        <Loading />
      ) : (
        <DataTable
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          empty="目前沒有逾期放款"
          columns={[
            {
              header: "放款編號",
              cell: (row) => (
                <Link to={`/loans/${row.id}`} className="font-medium text-brand-600 hover:underline">
                  {row.loanNumber}
                </Link>
              ),
            },
            {
              header: "客戶",
              cell: (row) => (
                <Link to={`/customers/${row.customer.id}`} className="hover:underline">
                  {row.customer.name}
                </Link>
              ),
            },
            { header: "風險", cell: (row) => <RiskGradeBadge grade={row.riskGrade} /> },
            { header: "狀態", cell: (row) => <StatusBadge status={row.status} /> },
            {
              header: "逾期天數",
              cell: (row) => <span className="tabular font-semibold text-rose-600">{row.daysOverdue}</span>,
            },
            {
              header: "逾期金額",
              cell: (row) => <Money value={row.overdueAmount} className="font-medium text-rose-600" />,
              className: "text-right",
            },
            { header: "總欠款", cell: (row) => <Money value={row.totalOutstanding} />, className: "text-right" },
            { header: "到期日", cell: (row) => date(row.maturityDate) },
            {
              header: "操作",
              cell: (row) => (
                <div className="flex gap-2">
                  <Link to={`/payments/new?loanId=${row.id}`} className="text-brand-600 hover:underline">
                    收款
                  </Link>
                  <Link to={`/loans/${row.id}`} className="text-slate-500 hover:underline">
                    明細
                  </Link>
                </div>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
