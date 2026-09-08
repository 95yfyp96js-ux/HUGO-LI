import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { date, money } from "../lib/format";
import { DataTable, ErrorBanner, Loading, PageHeader } from "../components/ui";

interface ScheduleItem {
  loanId: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  customerNumber: string;
  installmentNumber: number;
  dueDate: string;
  principalDue: string;
  interestDue: string;
  totalDue: string;
  remaining: string;
  status: "OVERDUE" | "DUE_TODAY" | "UPCOMING";
}

interface ScheduleResponse {
  from: string;
  to: string;
  items: ScheduleItem[];
}

const STATUS_LABEL: Record<ScheduleItem["status"], string> = {
  OVERDUE: "已逾期",
  DUE_TODAY: "今天到期",
  UPCOMING: "尚未到期",
};

const STATUS_CLASS: Record<ScheduleItem["status"], string> = {
  OVERDUE: "bg-rose-100 text-rose-700",
  DUE_TODAY: "bg-amber-100 text-amber-700",
  UPCOMING: "bg-slate-100 text-slate-600",
};

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysString(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 催款日程表 — every ScheduleLine still unpaid whose due date falls in the
 * selected range, straight from PaymentService.unpaidInstallments. The
 * calendar page groups the exact same data by day, so a count here and a
 * count there are guaranteed to agree.
 */
export function CollectionSchedulePage() {
  const [searchParams] = useSearchParams();
  const [from, setFrom] = useState(searchParams.get("from") ?? todayString());
  const [to, setTo] = useState(searchParams.get("to") ?? addDaysString(todayString(), 13));

  const { data, isLoading, error } = useQuery({
    queryKey: ["payments", "schedule", from, to],
    queryFn: () => api<ScheduleResponse>("/api/payments/schedule", { query: { from, to } }),
  });

  const totalRemaining = data
    ? data.items.reduce((sum, item) => sum + Number(item.remaining), 0)
    : 0;

  return (
    <div>
      <PageHeader title="催款日程表" subtitle="依日期區間列出所有尚未還清的期數，不限於已開案催收的放款" />

      <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="label" htmlFor="schedule-from">起始日期</label>
          <input
            id="schedule-from"
            type="date"
            className="input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="schedule-to">結束日期</label>
          <input
            id="schedule-to"
            type="date"
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <button
            className="btn-secondary"
            onClick={() => {
              setFrom(todayString());
              setTo(addDaysString(todayString(), 13));
            }}
          >
            未來 14 天
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              setFrom(addDaysString(todayString(), -30));
              setTo(todayString());
            }}
          >
            過去 30 天
          </button>
        </div>
      </div>

      {data && (
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="card p-4">
            <dt className="text-xs font-medium text-slate-500">未還期數</dt>
            <dd className="tabular mt-1 text-xl font-semibold text-slate-900">{data.items.length}</dd>
          </div>
          <div className="card p-4">
            <dt className="text-xs font-medium text-rose-700">未還餘額合計</dt>
            <dd className="tabular mt-1 text-xl font-semibold text-rose-700">{money(totalRemaining)}</dd>
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
          empty="這段期間沒有尚未還清的期數"
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
            { header: "期數", cell: (row) => <span className="tabular">{row.installmentNumber}</span> },
            { header: "應繳日", cell: (row) => date(row.dueDate) },
            { header: "本期本金", cell: (row) => <span className="tabular">{money(row.principalDue)}</span> },
            { header: "本期利息", cell: (row) => <span className="tabular">{money(row.interestDue)}</span> },
            {
              header: "未繳餘額",
              cell: (row) => <span className="tabular font-medium">{money(row.remaining)}</span>,
            },
            {
              header: "狀態",
              cell: (row) => (
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[row.status]}`}>
                  {STATUS_LABEL[row.status]}
                </span>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
