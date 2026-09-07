import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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

interface ApplicationRow {
  id: string;
  applicationNumber: string;
  status: string;
  requestedAmountCents: number;
  requestedTermCount: number;
  createdAt: string;
  customer: { id: string; name: string; customerNumber: string };
  requestedProduct: { id: string; name: string };
  riskAssessments: Array<{ grade: string; score: number; decision: string }>;
  loanOffers: Array<{ approvedAmountCents: number; ratePercent: number }>;
}

const FILTERS = [
  { id: "", label: "全部" },
  { id: "DRAFT", label: "草稿" },
  { id: "UNDER_REVIEW", label: "審核中" },
  { id: "RISK_REVIEW", label: "風控複審" },
  { id: "APPROVED", label: "已核准" },
  { id: "REJECTED", label: "已婉拒" },
];

export function ApplicationsPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["applications", status],
    queryFn: () =>
      api<{ items: ApplicationRow[]; total: number }>("/api/lending/applications", {
        query: { status, take: 50 },
      }),
  });

  return (
    <div>
      <PageHeader
        title="放款申請"
        subtitle={data ? `共 ${data.total} 件申請` : undefined}
        actions={
          can("APPLICATION_CREATE") && (
            <Link to="/lending/applications/new" className="btn-primary">
              新增申請
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
      {isLoading ? (
        <Loading />
      ) : (
        <DataTable
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          empty="沒有符合條件的申請"
          columns={[
            {
              header: "申請編號",
              cell: (row) => (
                <Link
                  to={`/lending/applications/${row.id}`}
                  className="font-medium text-brand-600 hover:underline"
                >
                  {row.applicationNumber}
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
            { header: "產品", cell: (row) => row.requestedProduct.name },
            {
              header: "申請金額",
              cell: (row) => <Money value={row.requestedAmountCents / 100} />,
              className: "text-right",
            },
            { header: "期數", cell: (row) => `${row.requestedTermCount} 期` },
            { header: "風險", cell: (row) => <RiskGradeBadge grade={row.riskAssessments[0]?.grade ?? null} /> },
            {
              header: "建議額度",
              cell: (row) =>
                row.loanOffers[0] ? <Money value={row.loanOffers[0].approvedAmountCents / 100} /> : "—",
              className: "text-right",
            },
            { header: "狀態", cell: (row) => <StatusBadge status={row.status} kind="application" /> },
            { header: "申請日", cell: (row) => date(row.createdAt) },
          ]}
        />
      )}
    </div>
  );
}
