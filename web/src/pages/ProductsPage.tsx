import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { percent, REPAYMENT_METHOD_LABELS } from "../lib/format";
import { DataTable, ErrorBanner, Loading, Money, PageHeader, StatusBadge } from "../components/ui";

export interface Product {
  id: string;
  productCode: string;
  name: string;
  description: string | null;
  minAmount: string;
  maxAmount: string;
  minTermMonths: number;
  maxTermMonths: number;
  ratePercent: number;
  rateUnit: string;
  calculationMethod: string;
  repaymentMethod: string;
  status: string;
  version: number;
  feeRules: Array<{ code: string; label: string; type: string; value: number }>;
}

export function ProductsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["products", "all"],
    queryFn: () => api<{ items: Product[] }>("/api/products"),
  });

  return (
    <div>
      <PageHeader
        title="放款產品"
        subtitle="修改利率或費用會建立新版本並封存舊版本，既有放款條件不受影響"
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
            { header: "期數", cell: (row) => `${row.minTermMonths}~${row.maxTermMonths} 期` },
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
    </div>
  );
}
