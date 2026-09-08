import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, tokenStore } from "../lib/api";
import { date, money } from "../lib/format";
import { DataTable, ErrorBanner, Loading, PageHeader } from "../components/ui";
import { useAuth } from "../lib/auth";
import { IS_SNAPSHOT } from "../lib/snapshot";

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

interface DailyCloseStatus {
  date: string;
  status: "OPEN" | "CLOSED" | "REOPENED";
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

const CLOSE_STATUS_LABEL: Record<DailyCloseStatus["status"], string> = {
  OPEN: "尚未關帳",
  CLOSED: "已關帳",
  REOPENED: "已重新開放",
};

/** Writes are blocked only when the row's own day is CLOSED — REOPENED still accepts new records. */
function isLocked(status: DailyCloseStatus["status"] | undefined): boolean {
  return status === "CLOSED";
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
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(todayString());
  const [reopening, setReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["payments", "due-today", selectedDate],
    queryFn: () => api<DueTodayResponse>("/api/payments/due-today", { query: { date: selectedDate } }),
  });

  const { data: closeStatus } = useQuery({
    queryKey: ["daily-close", selectedDate],
    queryFn: () => api<DailyCloseStatus>(`/api/daily-close/${selectedDate}`),
  });

  const invalidateClose = () =>
    queryClient.invalidateQueries({ queryKey: ["daily-close", selectedDate] });

  const closeMutation = useMutation({
    mutationFn: () => api(`/api/daily-close/${selectedDate}/close`, { method: "POST" }),
    onSuccess: invalidateClose,
  });

  const reopenMutation = useMutation({
    mutationFn: () =>
      api(`/api/daily-close/${selectedDate}/reopen`, {
        method: "POST",
        body: { reason: reopenReason },
      }),
    onSuccess: () => {
      setReopening(false);
      setReopenReason("");
      invalidateClose();
    },
  });

  async function downloadCsv() {
    const token = tokenStore.get();
    const response = await fetch(`/api/payments/due-today/export?date=${selectedDate}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `daily-close-${selectedDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

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

        {closeStatus && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              closeStatus.status === "CLOSED"
                ? "bg-slate-800 text-white"
                : closeStatus.status === "REOPENED"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-emerald-100 text-emerald-700"
            }`}
          >
            {CLOSE_STATUS_LABEL[closeStatus.status]}
          </span>
        )}

        <div className="ml-auto flex gap-2">
          {!IS_SNAPSHOT && (
            <button className="btn-secondary" onClick={downloadCsv}>
              下載 CSV
            </button>
          )}
          {can("DAILY_CLOSE_MANAGE") && closeStatus?.status !== "CLOSED" && (
            <button
              className="btn-primary"
              disabled={closeMutation.isPending}
              onClick={() => closeMutation.mutate()}
            >
              {closeMutation.isPending ? "關帳中…" : "關閉這天"}
            </button>
          )}
          {can("DAILY_CLOSE_MANAGE") && closeStatus?.status === "CLOSED" && (
            <button className="btn-secondary" onClick={() => setReopening(true)}>
              重新開放
            </button>
          )}
        </div>
      </div>

      {isLocked(closeStatus?.status) && (
        <div className="mb-4 rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm text-slate-700">
          這天已關帳：收款、沖銷、撥款紀錄不可再變更。如需修改，請先由主管重新開放並填寫原因。
        </div>
      )}

      <ErrorBanner error={closeMutation.error} />

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
                can("PAYMENT_CREATE") && !isLocked(closeStatus?.status) ? (
                  <Link to={`/payments/new?loanId=${row.loanId}`} className="btn-secondary">
                    登記收款
                  </Link>
                ) : null,
            },
          ]}
        />
      )}

      {reopening && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6">
            <h2 className="text-lg font-semibold">重新開放 {selectedDate}</h2>
            <p className="mt-1 text-sm text-slate-500">
              重新開放後，這天的收款／沖銷／撥款紀錄才能再變更。原因會記錄於稽核軌跡。
            </p>
            <textarea
              className="input mt-4"
              rows={3}
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="請說明重新開放的原因"
            />
            <ErrorBanner error={reopenMutation.error} />
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setReopening(false)}>
                取消
              </button>
              <button
                className="btn-primary"
                disabled={!reopenReason.trim() || reopenMutation.isPending}
                onClick={() => reopenMutation.mutate()}
              >
                {reopenMutation.isPending ? "處理中…" : "確認重新開放"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
