import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { date, money } from "../lib/format";
import {
  DataTable,
  ErrorBanner,
  KpiCard,
  Loading,
  Money,
  PageHeader,
  StatusBadge,
} from "../components/ui";

interface CollectionRow {
  id: string;
  caseNumber: string;
  status: string;
  priority: string;
  daysOverdue: number;
  outstandingAmountCents: number;
  nextActionAt: string | null;
  loan: { id: string; loanNumber: string; status: string };
  customer: { id: string; name: string; customerNumber: string; phone: string };
  assignedUser: { id: string; displayName: string } | null;
  activities: Array<{ createdAt: string; type: string; result: string | null }>;
  promises: Array<{ id: string }>;
}

interface CollectionDashboard {
  openCases: number;
  overdueAmount: string;
  highRiskCases: number;
  pendingPromises: number;
  todayFollowUps: number;
  recoveredAmount: string;
}

const FILTERS = [
  { id: "", label: "全部" },
  { id: "OPEN", label: "待處理" },
  { id: "IN_PROGRESS", label: "催收中" },
  { id: "PROMISE_TO_PAY", label: "已承諾還款" },
  { id: "PAID", label: "已還款" },
  { id: "CLOSED", label: "已結案" },
];

export function CollectionsPage() {
  const [status, setStatus] = useState("");

  const { data: dashboard } = useQuery({
    queryKey: ["collections-dashboard"],
    queryFn: () => api<CollectionDashboard>("/api/collections/dashboard"),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["collections", status],
    queryFn: () =>
      api<{ items: CollectionRow[]; total: number }>("/api/collections", { query: { status, take: 50 } }),
  });

  return (
    <div>
      <PageHeader title="催收" subtitle={data ? `共 ${data.total} 件案件` : undefined} />

      {dashboard && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <KpiCard label="催收案件" value={String(dashboard.openCases)} />
          <KpiCard label="逾期金額" value={money(dashboard.overdueAmount)} tone="danger" />
          <KpiCard label="高風險案件" value={String(dashboard.highRiskCases)} tone="danger" />
          <KpiCard label="今日待追蹤" value={String(dashboard.todayFollowUps)} tone="warning" />
          <KpiCard label="還款承諾" value={String(dashboard.pendingPromises)} />
        </div>
      )}

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
      {isLoading ? (
        <Loading />
      ) : (
        <DataTable
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          empty="沒有符合條件的催收案件"
          columns={[
            {
              header: "案件編號",
              cell: (row) => (
                <Link to={`/collections/${row.id}`} className="font-medium text-brand-600 hover:underline">
                  {row.caseNumber}
                </Link>
              ),
            },
            {
              header: "客戶",
              cell: (row) => (
                <div>
                  <Link to={`/customers/${row.customer.id}`} className="hover:underline">
                    {row.customer.name}
                  </Link>
                  <div className="tabular text-xs text-slate-400">{row.customer.phone}</div>
                </div>
              ),
            },
            {
              header: "放款",
              cell: (row) => (
                <Link to={`/loans/${row.loan.id}`} className="text-brand-600 hover:underline">
                  {row.loan.loanNumber}
                </Link>
              ),
            },
            { header: "優先度", cell: (row) => <StatusBadge status={row.priority} kind="priority" /> },
            { header: "狀態", cell: (row) => <StatusBadge status={row.status} kind="collection" /> },
            {
              header: "逾期天數",
              cell: (row) => <span className="tabular font-medium text-rose-600">{row.daysOverdue}</span>,
            },
            {
              header: "欠款",
              cell: (row) => <Money value={row.outstandingAmountCents / 100} className="font-medium" />,
              className: "text-right",
            },
            { header: "負責人", cell: (row) => row.assignedUser?.displayName ?? "未指派" },
            { header: "下次追蹤", cell: (row) => date(row.nextActionAt) },
          ]}
        />
      )}
    </div>
  );
}
