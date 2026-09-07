import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { percent, termRange, REPAYMENT_METHOD_LABELS } from "../lib/format";
import { DataTable, ErrorBanner, Loading, Money, PageHeader, StatusBadge } from "../components/ui";
import { useAuth } from "../lib/auth";
import {
  EMPTY_PRODUCT_FORM,
  ProductForm,
  productFormToPayload,
  validateProductForm,
  type ProductFormValues,
} from "../components/ProductForm";

export interface Product {
  id: string;
  productCode: string;
  name: string;
  description: string | null;
  minAmount: string;
  maxAmount: string;
  minTermCount: number;
  maxTermCount: number;
  termUnit: string;
  ratePercent: number;
  rateUnit: string;
  calculationMethod: string;
  repaymentMethod: string;
  status: string;
  version: number;
  feeRules: Array<{ code: string; label: string; type: string; value: number }>;
}

export function ProductsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ProductFormValues>(EMPTY_PRODUCT_FORM);
  const [validationError, setValidationError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["products", "all"],
    queryFn: () => api<{ items: Product[] }>("/api/products"),
  });

  const createMutation = useMutation({
    mutationFn: () => api<Product>("/api/products", { method: "POST", body: productFormToPayload(form) }),
    onSuccess: () => {
      setCreating(false);
      setForm(EMPTY_PRODUCT_FORM);
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

  function openCreate() {
    setForm(EMPTY_PRODUCT_FORM);
    setValidationError(null);
    setCreating(true);
  }

  function submitCreate() {
    const message = validateProductForm(form);
    setValidationError(message);
    if (!message) createMutation.mutate();
  }

  return (
    <div>
      <PageHeader
        title="放款產品"
        subtitle="修改條件會建立新版本並封存舊版本，既有放款條件不受影響"
        actions={
          can("PRODUCT_UPDATE") && (
            <button className="btn-primary" onClick={openCreate}>
              新增產品
            </button>
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
          empty="尚無產品"
          columns={[
            {
              header: "產品",
              cell: (row) => (
                <Link to={`/products/${row.id}`} className="font-medium text-brand-600 hover:underline">
                  {row.name}
                </Link>
              ),
            },
            { header: "代碼", cell: (row) => <span className="tabular">{row.productCode}</span> },
            { header: "版本", cell: (row) => `v${row.version}` },
            { header: "利率", cell: (row) => percent(row.ratePercent, row.rateUnit) },
            {
              header: "金額範圍",
              cell: (row) => (
                <span className="tabular text-xs">
                  <Money value={row.minAmount} /> ~ <Money value={row.maxAmount} />
                </span>
              ),
            },
            { header: "期間", cell: (row) => termRange(row.minTermCount, row.maxTermCount, row.termUnit) },
            {
              header: "還款方式",
              cell: (row) => REPAYMENT_METHOD_LABELS[row.repaymentMethod] ?? row.repaymentMethod,
            },
            {
              header: "狀態",
              cell: (row) => (
                <StatusBadge status={row.status === "ARCHIVED" ? "CANCELLED" : row.status} />
              ),
            },
          ]}
        />
      )}

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6">
            <h2 className="text-lg font-semibold">新增產品</h2>
            <p className="mt-1 text-sm text-slate-500">建立後即為 v1，上架狀態為 ACTIVE。</p>

            <div className="mt-4">
              <ProductForm values={form} onChange={setForm} codeEditable idPrefix="new-product" />
            </div>

            {validationError && <p className="mt-3 text-sm text-rose-600">{validationError}</p>}
            <ErrorBanner error={createMutation.error} />

            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setCreating(false)}>
                取消
              </button>
              <button
                className="btn-primary"
                onClick={submitCreate}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? "建立中…" : "建立產品"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
