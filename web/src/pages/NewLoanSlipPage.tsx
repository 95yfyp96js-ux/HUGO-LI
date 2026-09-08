import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, newIdempotencyKey } from "../lib/api";
import { date, money } from "../lib/format";
import { ErrorBanner, PageHeader } from "../components/ui";

interface Customer {
  id: string;
  name: string;
  customerNumber: string;
  phone: string;
  totalOutstanding: string;
}

interface Product {
  id: string;
  name: string;
  ratePercent: number;
  rateUnit: string;
}

type RepaymentMethod = "BULLET" | "PRINCIPAL_AND_INTEREST" | "EQUAL_INSTALLMENT" | "INTEREST_ONLY";

const REPAYMENT_METHODS: Array<{ value: RepaymentMethod; label: string; hint: string }> = [
  { value: "BULLET", label: "一次還本息", hint: "到期一次償還本金加全部利息" },
  { value: "PRINCIPAL_AND_INTEREST", label: "等額本金", hint: "每期本金相同，利息依剩餘本金遞減" },
  { value: "EQUAL_INSTALLMENT", label: "等額本息", hint: "每期本利合計金額大致相同" },
  { value: "INTEREST_ONLY", label: "只還息到期還本", hint: "每期只繳利息，本金到期一次還清" },
];

interface CreatedLoan {
  id: string;
  loanNumber: string;
  status: string;
  scheduleLines: Array<{
    id: string;
    installmentNumber: number;
    dueDate: string;
    principalDueCents: number;
    interestDueCents: number;
    totalDueCents: number;
  }>;
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 放款單 — 一筆借據一張單. Every term is typed in by hand for this one loan;
 * a template product only ever prefills the rate fields below, it is never
 * required and is never itself stored as a constraint. Nothing here computes
 * interest — the schedule shown after submit is exactly what the backend
 * RepaymentEngine returned.
 */
export function NewLoanSlipPage() {
  const navigate = useNavigate();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [templateId, setTemplateId] = useState("");

  const [principal, setPrincipal] = useState("");
  const [disbursedAt, setDisbursedAt] = useState(todayString());
  const [rateUnit, setRateUnit] = useState<"DAILY" | "MONTHLY">("DAILY");
  const [ratePercent, setRatePercent] = useState("");
  const [overdueRatePercent, setOverdueRatePercent] = useState("");
  const [repaymentMethod, setRepaymentMethod] = useState<RepaymentMethod>("BULLET");
  const [interestTiming, setInterestTiming] = useState<"POST_PAID" | "PRE_PAID">("POST_PAID");
  const [termMode, setTermMode] = useState<"days" | "date">("days");
  const [termCount, setTermCount] = useState("");
  const [maturityDate, setMaturityDate] = useState("");

  const [validationError, setValidationError] = useState<string | null>(null);
  const [loan, setLoan] = useState<CreatedLoan | null>(null);
  const [slipIdempotencyKey] = useState(newIdempotencyKey);
  const [disburseKey] = useState(newIdempotencyKey);

  const { data: customers } = useQuery({
    queryKey: ["customers", customerQuery],
    queryFn: () => api<{ items: Customer[] }>("/api/customers", { query: { q: customerQuery, take: 10 } }),
    enabled: customerQuery.length > 0,
  });

  const { data: products } = useQuery({
    queryKey: ["products", "ACTIVE"],
    queryFn: () => api<{ items: Product[] }>("/api/products", { query: { status: "ACTIVE" } }),
  });

  function applyTemplate(id: string) {
    setTemplateId(id);
    const product = products?.items.find((p) => p.id === id);
    if (product && (product.rateUnit === "DAILY" || product.rateUnit === "MONTHLY")) {
      setRateUnit(product.rateUnit);
      setRatePercent(String(product.ratePercent));
    }
  }

  const createSlip = useMutation({
    mutationFn: () =>
      api<{ loan: CreatedLoan; replayed: boolean }>("/api/loans/slip", {
        method: "POST",
        idempotencyKey: slipIdempotencyKey,
        body: {
          customerId: customer!.id,
          templateProductId: templateId || null,
          principal,
          disbursedAt: new Date(disbursedAt).toISOString(),
          rateUnit,
          ratePercent: Number(ratePercent),
          overdueRatePercent: overdueRatePercent ? Number(overdueRatePercent) : null,
          repaymentMethod,
          interestTiming,
          termCount: termMode === "days" ? Number(termCount) : undefined,
          maturityDate: termMode === "date" ? new Date(maturityDate).toISOString() : undefined,
        },
      }),
    onSuccess: (result) => setLoan(result.loan),
  });

  const disburse = useMutation({
    mutationFn: () =>
      api(`/api/loans/${loan!.id}/disburse`, {
        method: "POST",
        idempotencyKey: disburseKey,
        body: { method: "CASH" },
      }),
    onSuccess: () => navigate(`/loans/${loan!.id}`),
  });

  function submit() {
    if (!customer) {
      setValidationError("請先選擇客戶");
      return;
    }
    if (!principal || Number(principal) <= 0) {
      setValidationError("請輸入放款金額");
      return;
    }
    if (!ratePercent || Number(ratePercent) < 0) {
      setValidationError("請輸入利率");
      return;
    }
    if (termMode === "days" && (!termCount || Number(termCount) <= 0)) {
      setValidationError(rateUnit === "DAILY" ? "請輸入天數" : "請輸入月數");
      return;
    }
    if (termMode === "date" && !maturityDate) {
      setValidationError("請選擇到期日");
      return;
    }
    setValidationError(null);
    createSlip.mutate();
  }

  const termUnitLabel = rateUnit === "DAILY" ? "天數" : "月數";

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="放款單"
        subtitle="一筆借據一張單：每筆放款現填條件，產品僅供套用參考，不會限制或要求填寫"
      />

      {!loan ? (
        <div className="card space-y-5 p-5">
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">客戶</h2>
            {customer ? (
              <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
                <span>
                  <span className="font-medium">{customer.name}</span>
                  <span className="ml-2 text-xs text-slate-400">{customer.customerNumber}</span>
                </span>
                <button className="btn-secondary text-xs" onClick={() => setCustomer(null)}>
                  更換
                </button>
              </div>
            ) : (
              <>
                <input
                  className="input"
                  placeholder="搜尋客戶姓名、編號或電話"
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                />
                {customers && customers.items.length > 0 && (
                  <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {customers.items.map((c) => (
                      <li key={c.id}>
                        <button
                          className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-slate-50"
                          onClick={() => setCustomer(c)}
                        >
                          <span>
                            <span className="font-medium">{c.name}</span>
                            <span className="ml-2 text-xs text-slate-400">{c.customerNumber}</span>
                          </span>
                          <span className="tabular text-xs text-slate-500">
                            目前欠款 {money(c.totalOutstanding)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-xs text-slate-500">
                  找不到客戶？
                  <Link to="/customers/new" className="ml-1 text-brand-600 hover:underline">
                    先建立新客戶
                  </Link>
                </p>
              </>
            )}
          </div>

          <div>
            <label className="label" htmlFor="slip-template">套用產品範本（可留空）</label>
            <select
              id="slip-template"
              className="input"
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
            >
              <option value="">不套用範本，全部手動填寫</option>
              {products?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              範本只會帶入利率作為參考值，之後仍可自由修改；不會限制金額或期數。
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="slip-principal">放款金額 *</label>
              <input
                id="slip-principal"
                className="input tabular"
                inputMode="decimal"
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="slip-date">放款日 *</label>
              <input
                id="slip-date"
                type="date"
                className="input"
                value={disbursedAt}
                onChange={(e) => setDisbursedAt(e.target.value)}
              />
            </div>

            <div>
              <span className="label">利率單位 *</span>
              <div className="flex gap-4 pt-1 text-sm">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={rateUnit === "DAILY"}
                    onChange={() => setRateUnit("DAILY")}
                  />
                  日息
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={rateUnit === "MONTHLY"}
                    onChange={() => setRateUnit("MONTHLY")}
                  />
                  月息
                </label>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="slip-rate">
                利率（% / {rateUnit === "DAILY" ? "日" : "月"}）*
              </label>
              <input
                id="slip-rate"
                className="input tabular"
                inputMode="decimal"
                value={ratePercent}
                onChange={(e) => setRatePercent(e.target.value)}
              />
            </div>

            <div>
              <label className="label" htmlFor="slip-overdue-rate">逾期利率（% / {rateUnit === "DAILY" ? "日" : "月"}，可留空）</label>
              <input
                id="slip-overdue-rate"
                className="input tabular"
                inputMode="decimal"
                value={overdueRatePercent}
                onChange={(e) => setOverdueRatePercent(e.target.value)}
                placeholder="不填則不記錄"
              />
              <p className="mt-1 text-xs text-slate-500">
                僅記錄於借據備查，系統目前不會自動依此計算逾期罰息。
              </p>
            </div>

            <div>
              <span className="label">先收息／後收息 *</span>
              <div className="flex flex-col gap-1 pt-1 text-sm">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={interestTiming === "POST_PAID"}
                    onChange={() => setInterestTiming("POST_PAID")}
                  />
                  後收息（依還款期程收取，目前唯一支援方式）
                </label>
                <label className="flex items-center gap-1.5 text-slate-400">
                  <input type="radio" checked={interestTiming === "PRE_PAID"} disabled />
                  先收息（撥款時先扣除利息）— 系統尚未實作，暫無法選擇
                </label>
              </div>
            </div>
          </div>

          <div>
            <span className="label">還款方式 *</span>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              {REPAYMENT_METHODS.map((m) => (
                <label
                  key={m.value}
                  className={`flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 text-sm ${
                    repaymentMethod === m.value ? "border-brand-500 bg-brand-50" : "border-slate-200"
                  }`}
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    <input
                      type="radio"
                      checked={repaymentMethod === m.value}
                      onChange={() => setRepaymentMethod(m.value)}
                    />
                    {m.label}
                  </span>
                  <span className="pl-5 text-xs text-slate-500">{m.hint}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <span className="label">到期日或天數 *</span>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-sm">
                <input type="radio" checked={termMode === "days"} onChange={() => setTermMode("days")} />
                指定{termUnitLabel}
              </label>
              {termMode === "days" && (
                <input
                  className="input tabular w-32"
                  inputMode="numeric"
                  value={termCount}
                  onChange={(e) => setTermCount(e.target.value)}
                  placeholder={termUnitLabel}
                />
              )}
              <label className="flex items-center gap-1.5 text-sm">
                <input type="radio" checked={termMode === "date"} onChange={() => setTermMode("date")} />
                指定到期日
              </label>
              {termMode === "date" && (
                <input
                  type="date"
                  className="input w-40"
                  value={maturityDate}
                  onChange={(e) => setMaturityDate(e.target.value)}
                />
              )}
            </div>
          </div>

          {validationError && <p className="text-sm text-rose-600">{validationError}</p>}
          <ErrorBanner error={createSlip.error} />

          <div className="flex justify-end border-t border-slate-200 pt-4">
            <button className="btn-primary" onClick={submit} disabled={createSlip.isPending}>
              {createSlip.isPending ? "建立中…" : "建立放款單"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">還款約定表（{loan.loanNumber}）</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                    <th className="py-2 text-left">期數</th>
                    <th className="py-2 text-left">應繳日</th>
                    <th className="py-2 text-right">本金</th>
                    <th className="py-2 text-right">利息</th>
                    <th className="py-2 text-right">應繳合計</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loan.scheduleLines.map((line) => (
                    <tr key={line.id}>
                      <td className="tabular py-2">{line.installmentNumber}</td>
                      <td className="py-2">{date(line.dueDate)}</td>
                      <td className="tabular py-2 text-right">{money(line.principalDueCents / 100)}</td>
                      <td className="tabular py-2 text-right">{money(line.interestDueCents / 100)}</td>
                      <td className="tabular py-2 text-right font-medium">
                        {money(line.totalDueCents / 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">撥款</h2>
            <p className="mb-4 text-sm text-slate-500">
              確認後將撥款並使放款進入服務中狀態，之後可在放款頁對每一期做「回款確認」。此操作具備
              Idempotency-Key 保護。
            </p>
            <ErrorBanner error={disburse.error} />
            <div className="flex gap-2">
              <button
                className="btn-primary"
                onClick={() => disburse.mutate()}
                disabled={disburse.isPending}
              >
                {disburse.isPending ? "撥款中…" : "確認撥款"}
              </button>
              <button className="btn-secondary" onClick={() => navigate(`/loans/${loan.id}`)}>
                稍後撥款
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
