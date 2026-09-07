import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { date } from "../lib/format";
import { DataTable, ErrorBanner, Loading, Money, PageHeader, StatusBadge } from "../components/ui";

interface RenewalRow {
  id: string;
  reason: string;
  createdAt: string;
  previousLoan: {
    id: string;
    loanNumber: string;
    customer: { id: string; name: string; customerNumber: string };
  };
  newLoan: { id: string; loanNumber: string; principalCents: number; status: string };
}

export function RenewalsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["renewals"],
    queryFn: () => api<{ items: RenewalRow[]; total: number }>("/api/renewals", { query: { take: 50 } }),
  });

  return (
    <div>
      <PageHeader
        title="續借紀錄"
        subtitle={
          data
            ? `共 ${data.total} 筆續借。續借會建立新放款並保留原放款完整歷史。`
            : undefined
        }
      />

      <ErrorBanner error={error} />
      {isLoading ? (
        <Loading />
      ) : (
        <DataTable
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          empty="尚無續借紀錄"
          columns={[
            {
              header: "客戶",
              cell: (row) => (
                <Link to={`/customers/${row.previousLoan.customer.id}`} className="hover:underline">
                  {row.previousLoan.customer.name}
                </Link>
              ),
            },
            {
              header: "原放款",
              cell: (row) => (
                <Link to={`/loans/${row.previousLoan.id}`} className="text-brand-600 hover:underline">
                  {row.previousLoan.loanNumber}
                </Link>
              ),
            },
            { header: "", cell: () => <span className="text-slate-400">→</span> },
            {
              header: "新放款",
              cell: (row) => (
                <Link to={`/loans/${row.newLoan.id}`} className="font-medium text-brand-600 hover:underline">
                  {row.newLoan.loanNumber}
                </Link>
              ),
            },
            {
              header: "新放款金額",
              cell: (row) => <Money value={row.newLoan.principalCents / 100} className="font-medium" />,
              className: "text-right",
            },
            { header: "狀態", cell: (row) => <StatusBadge status={row.newLoan.status} /> },
            { header: "續借原因", cell: (row) => <span className="text-slate-600">{row.reason}</span> },
            { header: "續借日", cell: (row) => date(row.createdAt) },
          ]}
        />
      )}
    </div>
  );
}
