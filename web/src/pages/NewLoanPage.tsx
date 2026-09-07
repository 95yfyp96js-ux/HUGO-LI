import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, newIdempotencyKey } from "../lib/api";
import { date, money, percent, REPAYMENT_METHOD_LABELS } from "../lib/format";
import { ErrorBanner, Field, Loading, PageHeader, RiskGradeBadge } from "../components/ui";

/**
 * The origination wizard (§35). Every figure shown here — risk score, limit,
 * rate, interest, schedule — is produced by the backend engines. The wizard
 * only sequences the steps and displays what the server returns.
 */
const STEPS = [
  { id: 1, label: "選擇客戶" },
  { id: 2, label: "放款申請" },
  { id: 3, label: "風控與額度" },
  { id: 4, label: "放款條件" },
  { id: 5, label: "審核核准" },
  { id: 6, label: "建立放款" },
  { id: 7, label: "撥款" },
];

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
  minAmount: string;
  maxAmount: string;
  minTermCount: number;
  maxTermCount: number;
}

interface SubmitResult {
  application: { id: string; status: string };
  assessment: { grade: string; score: number; decision: string; reasons: string };
  limit: {
    maximumLimitCents: number;
    currentExposureCents: number;
    availableLimitCents: number;
    recommendedAmountCents: number;
    decision: string;
  };
  offer: {
    id: string;
    approvedAmountCents: number;
    ratePercent: number;
    rateUnit: string;
    termCount: number;
    feesCents: number;
    repaymentMethod: string;
    totalInterestCents: number;
    totalPayableCents: number;
  } | null;
}

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

export function NewLoanPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [form, setForm] = useState({
    requestedProductId: "",
    requestedAmount: "",
    requestedTermCount: "3",
    purpose: "",
    income: "",
    existingDebt: "",
  });
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [underwriting, setUnderwriting] = useState<SubmitResult | null>(null);
  const [loan, setLoan] = useState<CreatedLoan | null>(null);
  const [idempotencyKey] = useState(newIdempotencyKey);

  const { data: customers } = useQuery({
    queryKey: ["customers", customerQuery],
    queryFn: () => api<{ items: Customer[] }>("/api/customers", { query: { q: customerQuery, take: 10 } }),
    enabled: customerQuery.length > 0,
  });

  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ["products", "ACTIVE"],
    queryFn: () => api<{ items: Product[] }>("/api/products", { query: { status: "ACTIVE" } }),
  });

  const createApplication = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/api/lending/applications", {
        method: "POST",
        body: {
          customerId: customer!.id,
          requestedProductId: form.requestedProductId,
          requestedAmount: form.requestedAmount,
          requestedTermCount: Number(form.requestedTermCount),
          purpose: form.purpose || null,
          income: form.income || null,
          existingDebt: form.existingDebt || null,
        },
      }),
    onSuccess: (application) => {
      setApplicationId(application.id);
      submitApplication.mutate(application.id);
    },
  });

  const submitApplication = useMutation({
    mutationFn: (id: string) => api<SubmitResult>(`/api/lending/applications/${id}/submit`, { method: "POST" }),
    onSuccess: (result) => {
      setUnderwriting(result);
      setStep(3);
    },
  });

  const approve = useMutation({
    mutationFn: () =>
      api(`/api/lending/applications/${applicationId}/approve`, {
        method: "POST",
        body: { reason: "符合授信條件" },
      }),
    onSuccess: () => setStep(6),
  });

  const createLoan = useMutation({
    mutationFn: () => api<CreatedLoan>("/api/loans", { method: "POST", body: { applicationId } }),
    onSuccess: (created) => {
      setLoan(created);
      setStep(7);
    },
  });

  const disburse = useMutation({
    mutationFn: () =>
      api(`/api/loans/${loan!.id}/disburse`, {
        method: "POST",
        idempotencyKey,
        body: { method: "BANK_TRANSFER" },
      }),
    onSuccess: () => navigate(`/loans/${loan!.id}`),
  });

  const pendingError =
    createApplication.error ??
    submitApplication.error ??
    approve.error ??
    createLoan.error ??
    disburse.error;

  if (productsLoading) return <Loading />;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="新增放款" subtitle="所有金額、利率與期程皆由後端引擎計算" />

      <ol className="mb-6 flex flex-wrap gap-2">
        {STEPS.map((s) => (
          <li
            key={s.id}
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
              step === s.id
                ? "bg-brand-600 text-white"
                : step > s.id
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-slate-100 text-slate-500"
            }`}
          >
            <span>{step > s.id ? "✓" : s.id}</span>
            {s.label}
          </li>
        ))}
      </ol>

      <ErrorBanner error={pendingError} />

      {step === 1 && (
        <div className="card p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">選擇客戶</h2>
          <input
            className="input"
            placeholder="搜尋客戶姓名、編號或電話"
            value={customerQuery}
            onChange={(e) => setCustomerQuery(e.target.value)}
          />
          {customers && customers.items.length > 0 && (
            <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {customers.items.map((c) => (
                <li key={c.id}>
                  <button
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
                    onClick={() => {
                      setCustomer(c);
                      setStep(2);
                    }}
                  >
                    <span>
                      <span className="font-medium">{c.name}</span>
                      <span className="ml-2 text-xs text-slate-400">{c.customerNumber}</span>
                    </span>
                    <span className="tabular text-sm text-slate-500">
                      目前欠款 {money(c.totalOutstanding)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-sm text-slate-500">
            找不到客戶？
            <Link to="/customers/new" className="ml-1 text-brand-600 hover:underline">
              先建立新客戶
            </Link>
          </p>
        </div>
      )}

      {step === 2 && customer && (
        <div className="card p-5">
          <h2 className="mb-1 text-sm font-semibold text-slate-700">放款申請內容</h2>
          <p className="mb-4 text-xs text-slate-500">
            客戶：{customer.name}（{customer.customerNumber}）
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="newl-f1">放款產品 *</label>
              <select id="newl-f1"
                className="input"
                value={form.requestedProductId}
                onChange={(e) => setForm((f) => ({ ...f, requestedProductId: e.target.value }))}
              >
                <option value="">請選擇產品</option>
                {products?.items.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}（{percent(product.ratePercent, product.rateUnit)}）
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="newl-f2">申請金額 *</label>
              <input id="newl-f2"
                className="input tabular"
                inputMode="decimal"
                value={form.requestedAmount}
                onChange={(e) => setForm((f) => ({ ...f, requestedAmount: e.target.value }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="newl-f3">期數 *</label>
              <input id="newl-f3"
                className="input tabular"
                inputMode="numeric"
                value={form.requestedTermCount}
                onChange={(e) => setForm((f) => ({ ...f, requestedTermCount: e.target.value }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="newl-f4">月收入</label>
              <input id="newl-f4"
                className="input tabular"
                inputMode="decimal"
                value={form.income}
                onChange={(e) => setForm((f) => ({ ...f, income: e.target.value }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="newl-f5">現有負債</label>
              <input id="newl-f5"
                className="input tabular"
                inputMode="decimal"
                value={form.existingDebt}
                onChange={(e) => setForm((f) => ({ ...f, existingDebt: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="newl-f6">借款用途</label>
              <input id="newl-f6"
                className="input"
                value={form.purpose}
                onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
              />
            </div>
          </div>

          <div className="mt-5 flex justify-between border-t border-slate-200 pt-4">
            <button className="btn-secondary" onClick={() => setStep(1)}>
              上一步
            </button>
            <button
              className="btn-primary"
              onClick={() => createApplication.mutate()}
              disabled={
                !form.requestedProductId ||
                !form.requestedAmount ||
                createApplication.isPending ||
                submitApplication.isPending
              }
            >
              {createApplication.isPending || submitApplication.isPending
                ? "執行風控中…"
                : "送出並執行風控"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && underwriting && (
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">風險評估結果</h2>
            <div className="mb-3 flex items-center gap-3">
              <RiskGradeBadge grade={underwriting.assessment.grade} />
              <span className="tabular text-xl font-semibold">{underwriting.assessment.score} 分</span>
              <span className="text-sm text-slate-500">{underwriting.assessment.decision}</span>
            </div>
            <ul className="list-inside list-disc space-y-1 text-sm text-slate-600">
              {(JSON.parse(underwriting.assessment.reasons) as string[]).map((reason, index) => (
                <li key={index}>{reason}</li>
              ))}
            </ul>
          </div>

          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">放款額度</h2>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="核定上限">{money(underwriting.limit.maximumLimitCents / 100)}</Field>
              <Field label="目前曝險">{money(underwriting.limit.currentExposureCents / 100)}</Field>
              <Field label="可動用">{money(underwriting.limit.availableLimitCents / 100)}</Field>
              <Field label="建議金額">
                <span className="font-semibold text-brand-700">
                  {money(underwriting.limit.recommendedAmountCents / 100)}
                </span>
              </Field>
            </dl>
          </div>

          <div className="flex justify-between">
            <button className="btn-secondary" onClick={() => setStep(2)}>
              上一步
            </button>
            <button className="btn-primary" onClick={() => setStep(4)} disabled={!underwriting.offer}>
              {underwriting.offer ? "查看放款條件" : "額度不足，無法承作"}
            </button>
          </div>
        </div>
      )}

      {step === 4 && underwriting?.offer && (
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">放款條件</h2>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="核准金額">{money(underwriting.offer.approvedAmountCents / 100)}</Field>
              <Field label="放款利率">
                {percent(underwriting.offer.ratePercent, underwriting.offer.rateUnit)}
              </Field>
              <Field label="期數">{underwriting.offer.termCount} 期</Field>
              <Field label="還款方式">
                {REPAYMENT_METHOD_LABELS[underwriting.offer.repaymentMethod] ??
                  underwriting.offer.repaymentMethod}
              </Field>
              <Field label="總利息">{money(underwriting.offer.totalInterestCents / 100)}</Field>
              <Field label="費用">{money(underwriting.offer.feesCents / 100)}</Field>
            </dl>
            <div className="mt-4 border-t border-slate-200 pt-4">
              <Field label="總應還">
                <span className="text-2xl font-semibold">
                  {money(underwriting.offer.totalPayableCents / 100)}
                </span>
              </Field>
            </div>
          </div>

          <div className="flex justify-between">
            <button className="btn-secondary" onClick={() => setStep(3)}>
              上一步
            </button>
            <button className="btn-primary" onClick={() => setStep(5)}>
              下一步：審核
            </button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="card p-5">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">審核核准</h2>
          <p className="mb-4 text-sm text-slate-500">
            核准後將建立正式放款契約，核准人與核准時間會記錄於稽核軌跡。
          </p>
          <div className="flex justify-between">
            <button className="btn-secondary" onClick={() => setStep(4)}>
              上一步
            </button>
            <button className="btn-primary" onClick={() => approve.mutate()} disabled={approve.isPending}>
              {approve.isPending ? "核准中…" : "核准此申請"}
            </button>
          </div>
        </div>
      )}

      {step === 6 && (
        <div className="card p-5">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">建立放款</h2>
          <p className="mb-4 text-sm text-slate-500">
            建立時會同時鎖定放款條件快照並產生還款期程（單一交易，失敗全部回滾）。
          </p>
          <button
            className="btn-primary"
            onClick={() => createLoan.mutate()}
            disabled={createLoan.isPending}
          >
            {createLoan.isPending ? "建立中…" : "建立放款與還款期程"}
          </button>
        </div>
      )}

      {step === 7 && loan && (
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">
              還款期程（{loan.loanNumber}）
            </h2>
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
              確認後將撥款並使 Loan 進入放款中狀態。此操作具備 Idempotency-Key 保護。
            </p>
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
