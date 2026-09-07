import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { dateTime } from "../lib/format";
import { DataTable, ErrorBanner, Loading, Money, PageHeader, StatusBadge } from "../components/ui";
import { useAuth } from "../lib/auth";

interface PaymentRow {
  id: string;
  paymentNumber: string;
  amountCents: number;
  method: string;
  status: string;
  paidAt: string;
  allocations: Array<{ principalAmountCents: number; interestAmountCents: number; feeAmountCents: number }>;
  loan: { id: string; loanNumber: string };
  customer: { id: string; name: string; customerNumber: string };
}

export function PaymentsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [reversing, setReversing] = useState<PaymentRow | null>(null);
  const [reason, setReason] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["payments"],
    queryFn: () => api<{ items: PaymentRow[]; total: number }>("/api/payments", { query: { take: 50 } }),
  });

  const reverseMutation = useMutation({
    mutationFn: () =>
      api(`/api/payments/${reversing!.id}/reverse`, { method: "POST", body: { reason } }),
    onSuccess: () => {
      setReversing(null);
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["loans"] });
    },
  });

  return (
    <div>
      <PageHeader
        title="收款紀錄"
        subtitle={data ? `共 ${data.total} 筆收款` : undefined}
        actions={
          can("PAYMENT_CREATE") && (
            <Link to="/payments/new" className="btn-primary">
              快速收款
            </Link>
          )
        }
      />

      <ErrorBanner error={error} />
      {isLoading ? (
        <Loading />
      ) : (
        <DataTable
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          empty="尚無收款紀錄"
          columns={[
            { header: "收款編號", cell: (row) => <span className="tabular">{row.paymentNumber}</span> },
            { header: "收款時間", cell: (row) => dateTime(row.paidAt) },
            {
              header: "客戶",
              cell: (row) => (
                <Link to={`/customers/${row.customer.id}`} className="hover:underline">
                  {row.customer.name}
                </Link>
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
            {
              header: "金額",
              cell: (row) => <Money value={row.amountCents / 100} className="font-medium" />,
              className: "text-right",
            },
            {
              header: "本金",
              cell: (row) => <Money value={(row.allocations[0]?.principalAmountCents ?? 0) / 100} />,
              className: "text-right",
            },
            {
              header: "利息",
              cell: (row) => <Money value={(row.allocations[0]?.interestAmountCents ?? 0) / 100} />,
              className: "text-right",
            },
            { header: "方式", cell: (row) => row.method },
            {
              header: "狀態",
              cell: (row) => <StatusBadge status={row.status === "CONFIRMED" ? "PAID" : row.status} />,
            },
            {
              header: "操作",
              cell: (row) =>
                can("PAYMENT_REVERSE") && row.status === "CONFIRMED" ? (
                  <button className="text-xs text-rose-600 hover:underline" onClick={() => setReversing(row)}>
                    沖銷
                  </button>
                ) : null,
            },
          ]}
        />
      )}

      {reversing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6">
            <h2 className="text-lg font-semibold">沖銷收款 {reversing.paymentNumber}</h2>
            <p className="mt-1 text-sm text-slate-500">
              沖銷不會刪除原紀錄，系統會產生一筆反向金流事件並回復餘額。
            </p>
            <textarea
              className="input mt-4"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="請說明沖銷原因"
            />
            <ErrorBanner error={reverseMutation.error} />
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setReversing(null)}>
                取消
              </button>
              <button
                className="btn-danger"
                onClick={() => reverseMutation.mutate()}
                disabled={!reason.trim() || reverseMutation.isPending}
              >
                確認沖銷
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
