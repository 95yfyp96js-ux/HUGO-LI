import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, newIdempotencyKey } from "../lib/api";
import { date, money, percent, REPAYMENT_METHOD_LABELS } from "../lib/format";
import { DataTable, ErrorBanner, Loading, Money, PageHeader, StatusBadge } from "../components/ui";
import { useAuth } from "../lib/auth";
import type { LoanRow } from "./LoansPage";

interface LoanDetail {
  id: string;
  loanNumber: string;
  principalCents: number;
  maturityDate: string | null;
  customer: { name: string; customerNumber: string };
  snapshot: { ratePercent: number; rateUnit: string; termMonths: number; repaymentMethod: string } | null;
  scheduleLines: Array<{ installmentNumber: number; dueDate: string; totalDueCents: number }>;
}

export function PendingDisbursementPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["loans", "pending-disbursement"],
    queryFn: () =>
      api<{ items: LoanRow[]; total: number }>("/api/loans", {
        query: { pendingDisbursement: true, take: 100 },
      }),
  });

  return (
    <div>
      <PageHeader title="待撥款" subtitle={data ? `共 ${data.total} 筆待撥款` : undefined} />
      <ErrorBanner error={error} />

      {isLoading ? (
        <Loading />
      ) : (
        <DataTable
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          empty="目前沒有待撥款的放款"
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
            { header: "狀態", cell: (row) => <StatusBadge status={row.status} /> },
            {
              header: "核准金額",
              cell: (row) => <Money value={row.principalCents / 100} className="font-medium" />,
              className: "text-right",
            },
            { header: "利率", cell: (row) => percent(row.snapshot?.ratePercent, row.snapshot?.rateUnit) },
            { header: "期數", cell: (row) => (row.snapshot ? `${row.snapshot.termMonths} 期` : "—") },
            { header: "到期日", cell: (row) => date(row.maturityDate) },
            {
              header: "操作",
              cell: (row) =>
                can("LOAN_DISBURSE") ? (
                  <button className="btn-primary py-1 text-xs" onClick={() => setConfirming(row.id)}>
                    撥款
                  </button>
                ) : (
                  <span className="text-xs text-slate-400">無權限</span>
                ),
            },
          ]}
        />
      )}

      {confirming && (
        <DisbursementDialog
          loanId={confirming}
          onClose={() => setConfirming(null)}
          onDone={() => {
            setConfirming(null);
            queryClient.invalidateQueries({ queryKey: ["loans"] });
            queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          }}
        />
      )}
    </div>
  );
}

/**
 * Disbursement confirmation (§38): shows the exact terms about to be
 * committed before money moves, and sends a fresh Idempotency-Key so a
 * double-click cannot pay twice.
 */
function DisbursementDialog({
  loanId,
  onClose,
  onDone,
}: {
  loanId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [method, setMethod] = useState("BANK_TRANSFER");

  const { data: loan, isLoading } = useQuery({
    queryKey: ["loan", loanId],
    queryFn: () => api<LoanDetail>(`/api/loans/${loanId}`),
  });

  const mutation = useMutation({
    mutationFn: () =>
      api(`/api/loans/${loanId}/disburse`, { method: "POST", body: { method }, idempotencyKey }),
    onSuccess: onDone,
  });

  const firstInstallment = loan?.scheduleLines[0];
  const totalPayable = loan?.scheduleLines.reduce((sum, line) => sum + line.totalDueCents, 0) ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-lg rounded-t-2xl bg-white p-6 sm:rounded-2xl">
        <h2 className="text-lg font-semibold">撥款確認</h2>
        <p className="mt-1 text-sm text-slate-500">請確認以下放款條件，撥款後不可撤銷。</p>

        {isLoading || !loan ? (
          <Loading />
        ) : (
          <>
            <dl className="mt-4 space-y-2 rounded-lg bg-slate-50 p-4 text-sm">
              <Row label="客戶" value={`${loan.customer.name}（${loan.customer.customerNumber}）`} />
              <Row label="放款編號" value={loan.loanNumber} />
              <Row label="撥款金額" value={money(loan.principalCents / 100)} strong />
              <Row
                label="放款利率"
                value={percent(loan.snapshot?.ratePercent, loan.snapshot?.rateUnit)}
              />
              <Row label="期數" value={`${loan.snapshot?.termMonths ?? "—"} 期`} />
              <Row
                label="還款方式"
                value={REPAYMENT_METHOD_LABELS[loan.snapshot?.repaymentMethod ?? ""] ?? "—"}
              />
              <Row label="第一期應繳日" value={date(firstInstallment?.dueDate)} />
              <Row label="總應還" value={money(totalPayable / 100)} strong />
            </dl>

            <div className="mt-4">
              <label className="label" htmlFor="pend-f1">撥款方式</label>
              <select id="pend-f1" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="BANK_TRANSFER">銀行轉帳</option>
                <option value="CASH">現金</option>
                <option value="CHECK">支票</option>
              </select>
            </div>

            <ErrorBanner error={mutation.error} />

            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary" onClick={onClose} disabled={mutation.isPending}>
                取消
              </button>
              <button
                className="btn-primary"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
              >
                {mutation.isPending ? "撥款中…" : "確認撥款"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`tabular ${strong ? "font-semibold text-slate-900" : "text-slate-700"}`}>{value}</dd>
    </div>
  );
}
