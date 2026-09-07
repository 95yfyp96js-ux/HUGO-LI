import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { date, money } from "../lib/format";
import { DataTable, ErrorBanner, Loading, PageHeader } from "../components/ui";
import { useAuth } from "../lib/auth";

interface DueTodayItem {
  loanId: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  customerNumber: string;
  installmentNumber: number;
  dueDate: string;
  totalDue: string;
  totalPaid: string;
  remaining: string;
  status: "OVERDUE" | "DUE_TODAY";
}

interface DueTodayResponse {
  date: string;
  items: DueTodayItem[];
  totalRemaining: string;
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 今日應收: schedule lines due on one calendar day that are not yet fully
 * collected. Switching the date shows only that day's installments — it is
 * not a running total of everything unpaid up to it. All numbers come
 * straight from the server; nothing here is recomputed client-side.
 */
export function DueTodayPage() {
  const { can } = useAuth();
  const [selectedDate, setSelectedDate] = useState(todayString());

  const { data, isLoading, error } = useQuery({
    queryKey: ["payments", "due-today", selectedDate],
    queryFn: () => api<DueTodayResponse>("/api/payments/due-today", { query: { date: selectedDate } }),
  });

  return (
    <div>
      <PageHeader title="今日應收" subtitle="依到期日列出當天尚未收滿的期數，資料以後端為準" />

      <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="label" htmlFor="due-today-date">查詢日期</label>
          <input
            id="due-today-date"
            type="date"
            className="input"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </div>
        <button className="btn-secondary" onClick={() => setSelectedDate(todayString())}>
          回到今天
        </button>
        {data && (
          <div className="ml-auto text-sm text-slate-500">
            {data.items.length} 筆待收 ・ 合計未收 <span className="tabular font-medium text-slate-900">{money(data.totalRemaining)}</span>
          </div>
        )}
      </div>

      <ErrorBanner error={error} />
      {isLoading ? (
        <Loading />
      ) : (
        <DataTable
          rows={data?.items ?? []}
          rowKey={(row) => `${row.loanId}-${row.installmentNumber}`}
          empty="這一天沒有尚未收滿的期數"
          columns={[
            {
              header: "客戶",
              cell: (row) => (
                <Link to={`/customers/${row.customerId}`} className="font-medium text-brand-600 hover:underline">
                  {row.customerName}
                </Link>
              ),
            },
            {
              header: "貸號",
              cell: (row) => (
                <Link to={`/loans/${row.loanId}`} className="tabular text-brand-600 hover:underline">
                  {row.loanNumber}
                </Link>
              ),
            },
            { header: "到期日", cell: (row) => date(row.dueDate) },
            { header: "應收", cell: (row) => <span className="tabular">{money(row.totalDue)}</span> },
            { header: "已收", cell: (row) => <span className="tabular">{money(row.totalPaid)}</span> },
            {
              header: "未收",
              cell: (row) => <span className="tabular font-medium">{money(row.remaining)}</span>,
            },
            {
              header: "狀態",
              cell: (row) => (
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                    row.status === "OVERDUE"
                      ? "bg-rose-100 text-rose-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {row.status === "OVERDUE" ? "已逾期" : "今天到期"}
                </span>
              ),
            },
            {
              header: "",
              cell: (row) =>
                can("PAYMENT_CREATE") ? (
                  <Link to={`/payments/new?loanId=${row.loanId}`} className="btn-secondary">
                    登記收款
                  </Link>
                ) : null,
            },
          ]}
        />
      )}
    </div>
  );
}
