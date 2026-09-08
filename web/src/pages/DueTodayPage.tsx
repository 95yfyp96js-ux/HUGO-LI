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
  dueAmount: string;
  collectedToday: string;
  uncollected: string;
  status: "OVERDUE" | "DUE_TODAY";
}

interface DueTodayResponse {
  date: string;
  items: DueTodayItem[];
  summary: {
    dueCount: number;
    dueAmount: string;
    collectedCount: number;
    collectedAmount: string;
    uncollectedAmount: string;
  };
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 今日應收（日結）: the day's close for one Asia/Taipei calendar day.
 *
 * 應收 is installments due that day that were not already fully collected on
 * an earlier day. 實收 is every confirmed payment that landed that day,
 * whatever it paid down — a payment collected today for a different day's
 * installment still counts here. 未收 is 應收 minus only the part of today's
 * money that actually went toward today's due installments; money collected
 * today for some other day's installment does not shrink today's 未收.
 *
 * Every number comes from the server; nothing here is recomputed.
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
      <PageHeader title="今日應收" subtitle="依 Asia/Taipei 日界結算：應收／實收／未收，資料以後端為準" />

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
      </div>

      {data && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <div className="card p-4">
            <dt className="text-xs font-medium text-slate-500">應收</dt>
            <dd className="tabular mt-1 text-xl font-semibold text-slate-900">
              {money(data.summary.dueAmount)}
            </dd>
            <p className="mt-1 text-xs text-slate-400">{data.summary.dueCount} 筆到期</p>
          </div>
          <div className="card p-4">
            <dt className="text-xs font-medium text-emerald-700">實收</dt>
            <dd className="tabular mt-1 text-xl font-semibold text-emerald-700">
              {money(data.summary.collectedAmount)}
            </dd>
            <p className="mt-1 text-xs text-slate-400">{data.summary.collectedCount} 筆入帳</p>
          </div>
          <div className="card p-4">
            <dt className="text-xs font-medium text-rose-700">未收</dt>
            <dd className="tabular mt-1 text-xl font-semibold text-rose-700">
              {money(data.summary.uncollectedAmount)}
            </dd>
            <p className="mt-1 text-xs text-slate-400">當日應收扣除當日已分攤實收</p>
          </div>
        </div>
      )}

      <ErrorBanner error={error} />
      {isLoading ? (
        <Loading />
      ) : (
        <DataTable
          rows={data?.items ?? []}
          rowKey={(row) => `${row.loanId}-${row.installmentNumber}`}
          empty="這一天沒有到期的期數"
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
            { header: "應收", cell: (row) => <span className="tabular">{money(row.dueAmount)}</span> },
            {
              header: "實收",
              cell: (row) => <span className="tabular text-emerald-700">{money(row.collectedToday)}</span>,
            },
            {
              header: "未收",
              cell: (row) => <span className="tabular font-medium">{money(row.uncollected)}</span>,
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
