import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { date, percent, termNoun, termRange, REPAYMENT_METHOD_LABELS } from "../lib/format";
import {
  ProductForm,
  productFormToPayload,
  validateProductForm,
  type ProductFormValues,
} from "../components/ProductForm";
import { ErrorBanner, Field, Loading, Money, PageHeader, StatusBadge } from "../components/ui";
import { useAuth } from "../lib/auth";
import type { Product } from "./ProductsPage";

export function ProductDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProductFormValues | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["product", id],
    queryFn: () => api<Product & { createdAt: string }>(`/api/products/${id}`),
  });

  const mutation = useMutation({
    mutationFn: () => {
      if (!form) throw new Error("form not initialised");
      return api<Product>(`/api/products/${id}`, { method: "PATCH", body: productFormToPayload(form) });
    },
    onSuccess: (updated) => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      // Any of these fields versions the product: saving produces a new id.
      navigate(`/products/${updated.id}`);
    },
  });

  function openEdit() {
    if (!data) return;
    setForm({
      productCode: data.productCode,
      name: data.name,
      description: data.description ?? "",
      minAmount: data.minAmount,
      maxAmount: data.maxAmount,
      termUnit: data.termUnit as ProductFormValues["termUnit"],
      minTermCount: String(data.minTermCount),
      maxTermCount: String(data.maxTermCount),
      ratePercent: String(data.ratePercent),
      rateUnit: data.rateUnit as ProductFormValues["rateUnit"],
      repaymentMethod: data.repaymentMethod,
    });
    setValidationError(null);
    setEditing(true);
  }

  function submitEdit() {
    if (!form) return;
    const message = validateProductForm(form);
    setValidationError(message);
    if (!message) mutation.mutate();
  }

  if (isLoading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;
  if (!data) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={data.name}
        subtitle={`${data.productCode} ・ v${data.version}`}
        actions={
          can("PRODUCT_UPDATE") &&
          data.status === "ACTIVE" && (
            <button className="btn-secondary" onClick={openEdit}>
              編輯產品
            </button>
          )
        }
      />

      <div className="card p-5">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="狀態">
            <StatusBadge status={data.status === "ARCHIVED" ? "CANCELLED" : data.status} />
          </Field>
          <Field label="利率">{percent(data.ratePercent, data.rateUnit)}</Field>
          <Field label="計息方式">{data.calculationMethod}</Field>
          <Field label="還款方式">
            {REPAYMENT_METHOD_LABELS[data.repaymentMethod] ?? data.repaymentMethod}
          </Field>
          <Field label="最低金額">
            <Money value={data.minAmount} />
          </Field>
          <Field label="最高金額">
            <Money value={data.maxAmount} />
          </Field>
          <Field label={`${termNoun(data.termUnit)}範圍`}>
            {termRange(data.minTermCount, data.maxTermCount, data.termUnit)}
          </Field>
          <Field label="版本">v{data.version}</Field>
          <Field label="建立日期">{date(data.createdAt)}</Field>
          <div className="col-span-2 sm:col-span-3">
            <Field label="說明">{data.description ?? "—"}</Field>
          </div>
        </dl>

        <h2 className="mb-3 mt-6 text-sm font-semibold text-slate-700">費用規則</h2>
        {data.feeRules.length === 0 ? (
          <p className="text-sm text-slate-500">無額外費用</p>
        ) : (
          <ul className="space-y-2">
            {data.feeRules.map((fee) => (
              <li
                key={fee.code}
                className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm"
              >
                <span>{fee.label}</span>
                <span className="tabular font-medium">
                  {fee.type === "PERCENT_OF_PRINCIPAL" ? `${fee.value}%` : `NT$${fee.value}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6">
            <h2 className="text-lg font-semibold">編輯產品</h2>
            <p className="mt-1 text-sm text-slate-500">
              儲存會建立新版本（v{data.version + 1}）並封存目前版本。既有放款的條件快照不受影響。
            </p>

            <div className="mt-4">
              <ProductForm
                values={form}
                onChange={setForm}
                codeEditable={false}
                idPrefix="edit-product"
              />
            </div>

            {validationError && <p className="mt-3 text-sm text-rose-600">{validationError}</p>}
            <ErrorBanner error={mutation.error} />
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEditing(false)}>
                取消
              </button>
              <button
                className="btn-primary"
                onClick={submitEdit}
                disabled={mutation.isPending}
              >
                {mutation.isPending ? "建立中…" : "建立新版本"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
