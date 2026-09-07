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
  status: string;
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
                {product.name}（{product.ratePercent}%
                {product.rateUnit === "MONTHLY" ? "／月" : product.rateUnit === "DAILY" ? "／日" : "／年"}）
              </option>
            ))}
          </select>
          {selectedProduct && (
            <p className="mt-1 text-xs text-slate-500">
              金額 {selectedProduct.minAmount} ~ {selectedProduct.maxAmount}，期數{" "}
              {selectedProduct.minTermCount} ~ {selectedProduct.maxTermCount} 期
            </p>
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
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="newa-f4">申請期數 *</label>
            <input id="newa-f4"
              className="input tabular"
              inputMode="numeric"
              value={form.requestedTermCount}
              onChange={(e) => setForm((f) => ({ ...f, requestedTermCount: e.target.value }))}
              required
            />
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
            disabled={mutation.isPending || !customerId || !form.requestedProductId}
          >
            {mutation.isPending ? "建立中…" : "建立申請"}
          </button>
        </div>
      </form>
    </div>
  );
}
