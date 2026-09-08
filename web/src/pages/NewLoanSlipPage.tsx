import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, newIdempotencyKey } from "../lib/api";
import { date, money, REPAYMENT_METHOD_LABELS } from "../lib/format";
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

type RepaymentMethod = "EQUAL_INSTALLMENT" | "PRINCIPAL_AND_INTEREST" | "INTEREST_ONLY" | "BULLET";
type RateType = "DAILY" | "MONTHLY" | "ANNUAL" | "PERIOD";

// Order and names match the reference: 等額本息／等額本金／先息後本／一次本息.
const REPAYMENT_METHODS: Array<{ value: RepaymentMethod; hint: string }> = [
  { value: "EQUAL_INSTALLMENT", hint: "每期本利合計金額大致相同" },
  { value: "PRINCIPAL_AND_INTEREST", hint: "每期本金相同，利息依剩餘本金遞減" },
  { value: "INTEREST_ONLY", hint: "每期只繳利息，本金到期一次還清" },
  { value: "BULLET", hint: "到期一次償還本金加全部利息" },
];

const RATE_TYPES: Array<{ value: RateType; label: string }> = [
  { value: "DAILY", label: "日息" },
  { value: "MONTHLY", label: "月息" },
  { value: "ANNUAL", label: "年息" },
  { value: "PERIOD", label: "期利率" },
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

/** What "期限" counts in, for each rate type. */
function termNoun(rateType: RateType): string {
  if (rateType === "DAILY" || rateType === "PERIOD") return "天數";
  return "期數";
}

/**
 * 貸款登記 — 一筆借據一張單. This is the default way a loan is entered: every
 * term filled in by hand for this one loan, a template product only ever
 * prefills the rate fields below, never a requirement. Nothing here
 * computes interest — the schedule shown after submit is exactly what the
 * backend RepaymentEngine returned.
 */
export function NewLoanSlipPage() {
  const navigate = useNavigate();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [templateId, setTemplateId] = useState("");

  const [principal, setPrincipal] = useState("");
  const [disbursedAt, setDisbursedAt] = useState(todayString());
  const [rateType, setRateType] = useState<RateType>("DAILY");
  const [ratePercent, setRatePercent] = useState("");
  const [periodDays, setPeriodDays] = useState("");
  const [overdueRatePercent, setOverdueRatePercent] = useState("");
  const [repaymentMethod, setRepaymentMethod] = useState<RepaymentMethod>("BULLET");
  const [interestTiming, setInterestTiming] = useState<"POST_PAID" | "PRE_PAID">("POST_PAID");
  const [termCount, setTermCount] = useState("");

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
    if (product && (product.rateUnit === "DAILY" || product.rateUnit === "MONTHLY" || product.rateUnit === "ANNUAL")) {
      setRateType(product.rateUnit);
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
          rateUnit: rateType,
          ratePercent: Number(ratePercent),
          periodDays: rateType === "PERIOD" ? Number(periodDays) : undefined,
          overdueRatePercent: overdueRatePercent ? Number(overdueRatePercent) : null,
          repaymentMethod,
          interestTiming,
          termCount: Number(termCount),
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
    if (rateType === "PERIOD" && (!periodDays || Number(periodDays) <= 0)) {
      setValidationError("請輸入一期幾天");
      return;
    }
    if (!termCount || Number(termCount) <= 0) {
      setValidationError(`請輸入${termNoun(rateType)}`);
      return;
    }
    setValidationError(null);
    createSlip.mutate();
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="貸款登記"
        subtitle="一站式貸款記帳：每筆貸款自己現填條件，產品僅供套用參考，不會限制或要求填寫"
      />

      {!loan ? (
        <div className="card space-y-5 p-5">
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">客戶 *</h2>
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
              <label className="label" htmlFor="slip-principal">金額 *</label>
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

            <div className="sm:col-span-2">
              <span className="label">利率類型 *</span>
              <div className="flex flex-wrap gap-4 pt-1 text-sm">
                {RATE_TYPES.map((rt) => (
                  <label key={rt.value} className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      checked={rateType === rt.value}
                      onChange={() => setRateType(rt.value)}
                    />
                    {rt.label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="slip-rate">
                利率（% / {RATE_TYPES.find((r) => r.value === rateType)!.label}）*
              </label>
              <input
                id="slip-rate"
                className="input tabular"
                inputMode="decimal"
                value={ratePercent}
                onChange={(e) => setRatePercent(e.target.value)}
              />
            </div>

            {rateType === "PERIOD" && (
              <div>
                <label className="label" htmlFor="slip-period-days">一期幾天 *</label>
                <input
                  id="slip-period-days"
                  className="input tabular"
                  inputMode="numeric"
                  value={periodDays}
                  onChange={(e) => setPeriodDays(e.target.value)}
                  placeholder="例如 3"
                />
              </div>
            )}

            <div>
              <label className="label" htmlFor="slip-term">期限（{termNoun(rateType)}）*</label>
              <input
                id="slip-term"
                className="input tabular"
                inputMode="numeric"
                value={termCount}
                onChange={(e) => setTermCount(e.target.value)}
                placeholder={rateType === "PERIOD" ? "共幾期" : undefined}
              />
            </div>

            <div>
              <label className="label" htmlFor="slip-overdue-rate">
                逾期利率（% / {RATE_TYPES.find((r) => r.value === rateType)!.label}，可留空）
              </label>
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
                  後收息（依還款期程收取）
                </label>
                <label className="flex items-center gap-1.5 text-slate-400">
                  <input type="radio" checked={interestTiming === "PRE_PAID"} disabled />
                  先收息（撥款時先扣除利息）— 尚未開放
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
                    {REPAYMENT_METHOD_LABELS[m.value]}
                  </span>
                  <span className="pl-5 text-xs text-slate-500">{m.hint}</span>
                </label>
              ))}
            </div>
          </div>

          {validationError && <p className="text-sm text-rose-600">{validationError}</p>}
          <ErrorBanner error={createSlip.error} />

          <div className="flex justify-end border-t border-slate-200 pt-4">
            <button className="btn-primary" onClick={submit} disabled={createSlip.isPending}>
              {createSlip.isPending ? "建立中…" : "建立並產生還款計劃"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">還款計劃（{loan.loanNumber}）</h2>
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
