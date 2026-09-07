import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { date } from "../lib/format";
import { DataTable, ErrorBanner, Loading, Money, PageHeader, StatusBadge } from "../components/ui";
import { useAuth } from "../lib/auth";

interface CustomerRow {
  id: string;
  customerNumber: string;
  name: string;
  identityNumber: string;
  phone: string;
  status: string;
  activeLoanCount: number;
  overdueLoanCount: number;
  totalOutstanding: string;
  createdAt: string;
}

export function CustomersPage() {
  const { can } = useAuth();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["customers", search],
    queryFn: () => api<{ items: CustomerRow[]; total: number }>("/api/customers", { query: { q: search, take: 50 } }),
  });

  return (
    <div>
      <PageHeader
        title="客戶"
        subtitle={data ? `共 ${data.total} 位客戶` : undefined}
        actions={
          can("CUSTOMER_CREATE") && (
            <Link to="/customers/new" className="btn-primary">
              新增客戶
            </Link>
          )
        }
      />

      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(query);
        }}
      >
        <input
          className="input max-w-md"
          placeholder="搜尋姓名、客戶編號、電話、身分證字號或放款編號"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="btn-secondary">
          搜尋
        </button>
      </form>

      <ErrorBanner error={error} />
      {isLoading ? (
        <Loading />
      ) : (
        <DataTable
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          empty="找不到符合條件的客戶"
          columns={[
            {
              header: "客戶編號",
              cell: (row) => (
                <Link to={`/customers/${row.id}`} className="font-medium text-brand-600 hover:underline">
                  {row.customerNumber}
                </Link>
              ),
            },
            { header: "姓名", cell: (row) => <span className="font-medium">{row.name}</span> },
            { header: "身分證字號", cell: (row) => <span className="tabular text-slate-500">{row.identityNumber}</span> },
            { header: "電話", cell: (row) => <span className="tabular">{row.phone}</span> },
            { header: "狀態", cell: (row) => <StatusBadge status={row.status} /> },
            { header: "活躍放款", cell: (row) => `${row.activeLoanCount} 件` },
            {
              header: "目前欠款",
              cell: (row) => <Money value={row.totalOutstanding} className="font-medium" />,
              className: "text-right",
            },
            { header: "建檔日", cell: (row) => date(row.createdAt) },
          ]}
        />
      )}
    </div>
  );
}
