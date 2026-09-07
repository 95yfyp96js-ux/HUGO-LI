import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, newIdempotencyKey } from "../lib/api";
import { money } from "../lib/format";
import { ErrorBanner, Loading, PageHeader, StatusBadge } from "../components/ui";

interface LoanOption {
  id: string;
  loanNumber: string;
  status: string;
  totalOutstanding: string;
  customer: { id: string; name: string; customerNumber: string };
}

interface Preview {
  outstanding: { principal: string; interest: string; fees: string; total: string };
  allocation: { interest: string; fee: string; principal: string; unallocated: string };
}

/**
 * Quick payment (§39). The allocation preview comes from the server's
 * AllocationEngine — the UI never splits a payment itself.
 */
export function NewPaymentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [loanId, setLoanId] = useState(searchParams.get("loanId") ?? "");
  const [query, setQuery] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const { data: loans } = useQuery({
    queryKey: ["loans", "search", query],
    queryFn: () =>
      api<{ items: LoanOption[] }>("/api/loans", { query: { take: 50 } }).then((result) => ({
        items: result.items.filter(
          (loan) =>
            ["ACTIVE", "DUE_SOON", "DUE", "OVERDUE", "DEFAULTED"].includes(loan.status) &&
            (query === "" ||
              loan.loanNumber.toLowerCase().includes(query.toLowerCase()) ||
              loan.customer.name.includes(query) ||
              loan.customer.customerNumber.toLowerCase().includes(query.toLowerCase()))
        ),
      })),
  });

  const selectedLoan = loans?.items.find((loan) => loan.id === loanId);

  const { data: preview, isFetching: previewLoading } = useQuery({
    queryKey: ["payment-preview", loanId, amount],
    queryFn: () =>
      api<Preview>("/api/payments/preview", { method: "POST", body: { loanId, amount } }),
    enabled: Boolean(loanId) && Number(amount) > 0,
  });

  const mutation = useMutation({
    mutationFn: () =>
      api<{ payment: { id: string; loanId: string } }>("/api/payments", {
        method: "POST",
        idempotencyKey,
        body: { loanId, amount, method },
      }),
    onSuccess: (result) => navigate(`/loans/${result.payment.loanId}`),
  });

  // A new key per loan/amount combination, so retrying a failed submit is
  // safe but a genuinely new payment is never blocked.
  useEffect(() => {
    setIdempotencyKey(newIdempotencyKey());
  }, [loanId]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="快速收款" subtitle="分配方式由後端 Allocation Engine 計算：利息 → 費用 → 本金" />

      <div className="card space-y-5 p-5">
        <ErrorBanner error={mutation.error} />

        <div>
          <label className="label" htmlFor="newp-f1">選擇放款 *</label>
          {selectedLoan ? (
            <div className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 p-3">
              <div>
                <div className="font-medium text-brand-900">{selectedLoan.loanNumber}</div>
                <div className="text-xs text-brand-700">
                  {selectedLoan.customer.name}（{selectedLoan.customer.customerNumber}）
                </div>
              </div>
              <div className="text-right">
                <StatusBadge status={selectedLoan.status} />
                <div className="tabular mt-1 text-sm font-semibold">
                  {money(selectedLoan.totalOutstanding)}
                </div>
              </div>
            </div>
          ) : (
            <>
              <input id="newp-f1"
                className="input"
                placeholder="輸入放款編號或客戶姓名"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {loans && loans.items.length > 0 && (
                <ul className="mt-2 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                  {loans.items.slice(0, 20).map((loan) => (
                    <li key={loan.id}>
                      <button
                        type="button"
                        className="touch-target flex w-full items-center justify-between px-3 text-left hover:bg-slate-50"
                        onClick={() => setLoanId(loan.id)}
                      >
                        <span>
                          <span className="font-medium">{loan.loanNumber}</span>
                          <span className="ml-2 text-xs text-slate-500">{loan.customer.name}</span>
                        </span>
                        <span className="tabular text-sm">{money(loan.totalOutstanding)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {loanId && (
          <>
            <div>
              <label className="label" htmlFor="newp-f2">收款金額 *</label>
              <input id="newp-f2"
                className="input tabular text-lg"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
              {preview && (
                <button
                  type="button"
                  className="mt-2 text-xs text-brand-600 hover:underline"
                  onClick={() => setAmount(preview.outstanding.total)}
                >
                  全額結清（{money(preview.outstanding.total)}）
                </button>
              )}
            </div>

            <div>
              <label className="label" htmlFor="newp-f3">收款方式</label>
              <select id="newp-f3" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="CASH">現金</option>
                <option value="BANK_TRANSFER">銀行轉帳</option>
                <option value="ATM">ATM</option>
                <option value="CHECK">支票</option>
              </select>
            </div>

            {previewLoading && <Loading label="計算分配中…" />}

            {preview && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-700">目前欠款</h3>
                <dl className="mb-4 space-y-1.5 text-sm">
                  <Row label="本金" value={preview.outstanding.principal} />
                  <Row label="利息" value={preview.outstanding.interest} />
                  <Row label="費用" value={preview.outstanding.fees} />
                  <div className="border-t border-slate-300 pt-1.5">
                    <Row label="總計" value={preview.outstanding.total} strong />
                  </div>
                </dl>

                <h3 className="mb-3 text-sm font-semibold text-slate-700">本次分配</h3>
                <dl className="space-y-1.5 text-sm">
                  <Row label="利息" value={preview.allocation.interest} />
                  <Row label="費用" value={preview.allocation.fee} />
                  <Row label="本金" value={preview.allocation.principal} />
                  {Number(preview.allocation.unallocated) > 0 && (
                    <Row label="未分配（超額）" value={preview.allocation.unallocated} warn />
                  )}
                </dl>
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
              <button type="button" className="btn-secondary" onClick={() => navigate("/payments")}>
                取消
              </button>
              <button
                className="btn-primary"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || !amount || Number(amount) <= 0}
              >
                {mutation.isPending ? "處理中…" : "確認收款"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  warn,
}: {
  label: string;
  value: string;
  strong?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-600">{label}</dt>
      <dd
        className={`tabular ${strong ? "font-semibold" : ""} ${warn ? "text-amber-600" : "text-slate-900"}`}
      >
        {money(value)}
      </dd>
    </div>
  );
}
