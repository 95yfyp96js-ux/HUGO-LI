import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { dateTime } from "../lib/format";
import { DataTable, ErrorBanner, Loading, PageHeader } from "../components/ui";

interface AuditRow {
  id: string;
  action: string;
  resource: string;
  resourceId: string;
  before: string | null;
  after: string | null;
  reason: string | null;
  timestamp: string;
  ip: string | null;
  user: { id: string; displayName: string; email: string } | null;
}

const ACTION_LABELS: Record<string, string> = {
  CUSTOMER_CREATED: "建立客戶",
  CUSTOMER_UPDATED: "修改客戶",
  APPLICATION_CREATED: "建立申請",
  APPLICATION_SUBMITTED: "送出申請",
  APPLICATION_APPROVED: "核准申請",
  APPLICATION_REJECTED: "婉拒申請",
  RISK_ASSESSMENT_CREATED: "風險評估",
  LENDING_LIMIT_CALCULATED: "額度計算",
  LOAN_OFFER_CREATED: "產生放款條件",
  LOAN_CREATED: "建立放款",
  LOAN_DISBURSED: "撥款",
  PAYMENT_CREATED: "收款",
  PAYMENT_REVERSED: "沖銷收款",
  SETTLEMENT_CREATED: "結清",
  RENEWAL_CREATED: "續借",
  EXTENSION_CREATED: "展期",
  COLLECTION_CASE_CREATED: "建立催收案件",
  COLLECTION_ACTIVITY_CREATED: "催收紀錄",
  PROMISE_TO_PAY_CREATED: "還款承諾",
  PRODUCT_CREATED: "建立產品",
  PRODUCT_UPDATED: "修改產品",
};

export function AuditLogsPage() {
  const [resource, setResource] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["audit-logs", resource],
    queryFn: () =>
      api<{ items: AuditRow[]; total: number }>("/api/audit-logs", { query: { resource, take: 100 } }),
  });

  const resources = ["", "Customer", "LendingApplication", "Loan", "Payment", "LoanProduct", "CollectionCase"];

  return (
    <div>
      <PageHeader
        title="操作紀錄"
        subtitle={
          data
            ? `共 ${data.total} 筆稽核紀錄。稽核紀錄僅供追加，任何使用者皆無法刪除。`
            : undefined
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {resources.map((item) => (
          <button
            key={item || "all"}
            onClick={() => setResource(item)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
              resource === item
                ? "bg-brand-600 text-white"
                : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {item || "全部"}
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
          empty="尚無稽核紀錄"
          columns={[
            { header: "時間", cell: (row) => dateTime(row.timestamp) },
            { header: "操作人", cell: (row) => row.user?.displayName ?? "系統" },
            {
              header: "操作",
              cell: (row) => (
                <span className="font-medium">{ACTION_LABELS[row.action] ?? row.action}</span>
              ),
            },
            { header: "對象", cell: (row) => <span className="text-xs text-slate-500">{row.resource}</span> },
            { header: "原因", cell: (row) => row.reason ?? "—" },
            { header: "IP", cell: (row) => <span className="tabular text-xs">{row.ip ?? "—"}</span> },
            {
              header: "內容",
              cell: (row) => (
                <button
                  className="text-xs text-brand-600 hover:underline"
                  onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                >
                  {expanded === row.id ? "收合" : "展開"}
                </button>
              ),
            },
          ]}
        />
      )}

      {expanded && (
        <div className="card mt-4 p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">變更內容</h2>
          {(() => {
            const row = data?.items.find((item) => item.id === expanded);
            if (!row) return null;
            return (
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-medium text-slate-500">變更前</div>
                  <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs">
                    {row.before ? JSON.stringify(JSON.parse(row.before), null, 2) : "—"}
                  </pre>
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-slate-500">變更後</div>
                  <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs">
                    {row.after ? JSON.stringify(JSON.parse(row.after), null, 2) : "—"}
                  </pre>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
