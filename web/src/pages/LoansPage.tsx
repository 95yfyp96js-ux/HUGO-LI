import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { date, percent } from "../lib/format";
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

export interface LoanRow {
  id: string;
  loanNumber: string;
  status: string;
  principalCents: number;
  totalOutstanding: string;
  outstandingPrincipalCents: number;
  outstandingInterestCents: number;
  daysOverdue: number;
  overdueAmount: string;
  nextDueDate: string | null;
  maturityDate: string | null;
  riskGrade: string | null;
  customer: { id: string; name: string; customerNumber: string };
  snapshot: { ratePercent: number; rateUnit: string; termCount: number } | null;
}

const FILTERS = [
  { id: "", label: "全部" },
  { id: "READY_FOR_DISBURSEMENT", label: "待撥款" },
  { id: "ACTIVE", label: "放款中" },
  { id: "DUE", label: "今日到期" },
  { id: "OVERDUE", label: "逾期" },
  { id: "RESTRUCTURED", label: "已重整" },
  { id: "PAID_OFF", label: "已結清" },
];

export function LoansPage() {
  const { can } = useAuth();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState(searchParams.get("status") ?? "");

  const { data, isLoading, error } = useQuery({
    queryKey: ["loans", status],
    queryFn: () => api<{ items: LoanRow[]; total: number }>("/api/loans", { query: { status, take: 50 } }),
  });

  return (
    <div>
      <PageHeader
        title="放款帳戶"
        subtitle={data ? `共 ${data.total} 筆放款` : undefined}
        actions={
          can("LOAN_CREATE") && (
            <Link to="/loans/new" className="btn-primary">
              新增放款
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <button
            key={filter.id}
            onClick={() => setStatus(filter.id)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
              status === filter.id
                ? "bg-brand-600 text-white"
                : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <ErrorBanner error={error} />
      {isLoading ? <Loading /> : <LoanTable rows={data?.items ?? []} />}
    </div>
  );
}

export function LoanTable({ rows, empty }: { rows: LoanRow[]; empty?: string }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.id}
      empty={empty ?? "沒有符合條件的放款"}
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
              <span className="ml-1 text-xs text-slate-400">{row.customer.customerNumber}</span>
            </Link>
          ),
        },
        { header: "狀態", cell: (row) => <StatusBadge status={row.status} /> },
        { header: "風險", cell: (row) => <RiskGradeBadge grade={row.riskGrade} /> },
        {
          header: "放款金額",
          cell: (row) => <Money value={row.principalCents / 100} />,
          className: "text-right",
        },
        {
          header: "剩餘本金",
          cell: (row) => <Money value={row.outstandingPrincipalCents / 100} />,
          className: "text-right",
        },
        {
          header: "總欠款",
          cell: (row) => <Money value={row.totalOutstanding} className="font-medium" />,
          className: "text-right",
        },
        {
          header: "利率",
          cell: (row) => percent(row.snapshot?.ratePercent, row.snapshot?.rateUnit),
        },
        { header: "到期日", cell: (row) => date(row.maturityDate) },
        {
          header: "逾期",
          cell: (row) =>
            row.daysOverdue > 0 ? (
              <span className="tabular font-medium text-rose-600">{row.daysOverdue} 天</span>
            ) : (
              <span className="text-slate-400">—</span>
            ),
        },
      ]}
    />
  );
}
