import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { ErrorBanner, Loading, PageHeader } from "../components/ui";

interface Product {
  id: string;
  name: string;
  productCode: string;
  minAmount: string;
  maxAmount: string;
  minTermCount: number;
  maxTermCount: number;
  ratePercent: number;
  rateUnit: string;
  termUnit: "DAY" | "MONTH";
  status: string;
}

const RATE_UNIT_LABEL: Record<string, string> = { DAILY: "日", MONTHLY: "月", ANNUAL: "年" };

/** A day product asks for 天數; a month product asks for 期數. */
function termNoun(termUnit: string) {
  return termUnit === "DAY" ? "天數" : "期數";
}
function termSuffix(termUnit: string) {
  return termUnit === "DAY" ? "天" : "期";
}

interface CustomerOption {
  id: string;
  name: string;
  customerNumber: string;
}

export function NewApplicationPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [customerId, setCustomerId] = useState(searchParams.get("customerId") ?? "");
  const [customerQuery, setCustomerQuery] = useState("");
  const [form, setForm] = useState({
    requestedProductId: "",
    requestedAmount: "",
    requestedTermCount: "3",
    purpose: "",
    income: "",
    existingDebt: "",
  });

  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ["products", "ACTIVE"],
    queryFn: () => api<{ items: Product[] }>("/api/products", { query: { status: "ACTIVE" } }),
  });

  const { data: customers } = useQuery({
    queryKey: ["customers", customerQuery],
    queryFn: () =>
      api<{ items: CustomerOption[] }>("/api/customers", { query: { q: customerQuery, take: 10 } }),
    enabled: customerQuery.length > 0,
  });

  const mutation = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/api/lending/applications", {
        method: "POST",
        body: {
          customerId,
          requestedProductId: form.requestedProductId,
          requestedAmount: form.requestedAmount,
          requestedTermCount: Number(form.requestedTermCount),
          purpose: form.purpose || null,
          income: form.income || null,
          existingDebt: form.existingDebt || null,
        },
      }),
    onSuccess: (application) => navigate(`/lending/applications/${application.id}`),
  });

  const selectedProduct = products?.items.find((p) => p.id === form.requestedProductId);

  // The same limits the server enforces, checked here so the reason is visible
  // before the request is sent. The server remains the authority — this only
  // saves the round trip and explains the refusal in the field it belongs to.
  const amountValue = Number(form.requestedAmount);
  const termValue = Number(form.requestedTermCount);
  const amountError =
    selectedProduct && form.requestedAmount !== "" &&
    (!Number.isFinite(amountValue) ||
      amountValue < Number(selectedProduct.minAmount) ||
      amountValue > Number(selectedProduct.maxAmount))
      ? `金額需介於 ${selectedProduct.minAmount} ~ ${selectedProduct.maxAmount}`
      : null;
  const termError =
    selectedProduct && form.requestedTermCount !== "" &&
    (!Number.isInteger(termValue) ||
      termValue < selectedProduct.minTermCount ||
      termValue > selectedProduct.maxTermCount)
      ? `${termNoun(selectedProduct.termUnit)}需介於 ${selectedProduct.minTermCount} ~ ${selectedProduct.maxTermCount}${termSuffix(selectedProduct.termUnit)}`
      : null;
  const canSubmit =
    Boolean(customerId) &&
    Boolean(form.requestedProductId) &&
    form.requestedAmount !== "" &&
    form.requestedTermCount !== "" &&
    !amountError &&
    !termError;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate();
  }

  if (productsLoading) return <Loading />;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="新增放款申請" subtitle="送出後系統會自動執行風控、額度與定價" />

      <form onSubmit={onSubmit} className="card space-y-5 p-5">
        <ErrorBanner error={mutation.error} />

        <div>
          <label className="label" htmlFor="newa-f1">客戶 *</label>
          {customerId ? (
            <div className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
              <span className="text-sm font-medium text-brand-900">
                {customers?.items.find((c) => c.id === customerId)?.name ?? "已選擇客戶"}
              </span>
              <button type="button" className="text-xs text-brand-700 underline" onClick={() => setCustomerId("")}>
                更換
              </button>
            </div>
          ) : (
            <>
              <input id="newa-f1"
                className="input"
                placeholder="搜尋客戶姓名或編號"
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
              />
              {customers && customers.items.length > 0 && (
                <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {customers.items.map((customer) => (
                    <li key={customer.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                        onClick={() => setCustomerId(customer.id)}
                      >
                        {customer.name}
                        <span className="ml-2 text-xs text-slate-400">{customer.customerNumber}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div>
          <label className="label" htmlFor="newa-f2">放款產品 *</label>
          <select id="newa-f2"
            className="input"
            value={form.requestedProductId}
            onChange={(e) => setForm((f) => ({ ...f, requestedProductId: e.target.value }))}
            required
          >
            <option value="">請選擇產品</option>
            {products?.items.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}（{product.ratePercent}%／{RATE_UNIT_LABEL[product.rateUnit] ?? product.rateUnit}）
              </option>
            ))}
          </select>
          {selectedProduct && (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-slate-500">利率</dt>
                <dd className="tabular font-medium text-slate-900">
                  {selectedProduct.ratePercent}%／{RATE_UNIT_LABEL[selectedProduct.rateUnit] ?? selectedProduct.rateUnit}
                  <span className="ml-1 font-normal text-slate-500">單利</span>
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">可借金額</dt>
                <dd className="tabular font-medium text-slate-900">
                  {selectedProduct.minAmount} ~ {selectedProduct.maxAmount}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">可借{termNoun(selectedProduct.termUnit)}</dt>
                <dd className="tabular font-medium text-slate-900">
                  {selectedProduct.minTermCount} ~ {selectedProduct.maxTermCount}
                  {termSuffix(selectedProduct.termUnit)}
                </dd>
              </div>
            </dl>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="newa-f3">申請金額 *</label>
            <input id="newa-f3"
              className="input tabular"
              inputMode="decimal"
              value={form.requestedAmount}
              onChange={(e) => setForm((f) => ({ ...f, requestedAmount: e.target.value }))}
              aria-invalid={amountError ? true : undefined}
              required
            />
            {amountError && <p className="mt-1 text-xs text-rose-600">{amountError}</p>}
          </div>
          <div>
            <label className="label" htmlFor="newa-f4">
              申請{selectedProduct ? termNoun(selectedProduct.termUnit) : "期數"} *
            </label>
            <input id="newa-f4"
              className="input tabular"
              inputMode="numeric"
              value={form.requestedTermCount}
              onChange={(e) => setForm((f) => ({ ...f, requestedTermCount: e.target.value }))}
              aria-invalid={termError ? true : undefined}
              required
            />
            {termError && <p className="mt-1 text-xs text-rose-600">{termError}</p>}
          </div>
          <div>
            <label className="label" htmlFor="newa-f5">月收入</label>
            <input id="newa-f5"
              className="input tabular"
              inputMode="decimal"
              value={form.income}
              onChange={(e) => setForm((f) => ({ ...f, income: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="newa-f6">現有負債</label>
            <input id="newa-f6"
              className="input tabular"
              inputMode="decimal"
              value={form.existingDebt}
              onChange={(e) => setForm((f) => ({ ...f, existingDebt: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="newa-f7">借款用途</label>
            <input id="newa-f7"
              className="input"
              value={form.purpose}
              onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <button type="button" className="btn-secondary" onClick={() => navigate("/lending/applications")}>
            取消
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={mutation.isPending || !canSubmit}
          >
            {mutation.isPending ? "建立中…" : "建立申請"}
          </button>
        </div>
      </form>
    </div>
  );
}
