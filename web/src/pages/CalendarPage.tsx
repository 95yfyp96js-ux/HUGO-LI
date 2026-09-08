import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { money } from "../lib/format";
import { ErrorBanner, Loading, PageHeader } from "../components/ui";

interface CalendarDay {
  date: string;
  count: number;
  amount: string;
}

interface CalendarResponse {
  month: string;
  days: CalendarDay[];
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year!, m! - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * 月曆 — days with outstanding receivables, count and amount, built from the
 * same PaymentService.unpaidInstallments query the 催款日程表 list uses (via
 * calendarSummary), so a day's badge here and its drill-down list always
 * agree.
 */
export function CalendarPage() {
  const [month, setMonth] = useState(currentMonth());

  const { data, isLoading, error } = useQuery({
    queryKey: ["payments", "calendar", month],
    queryFn: () => api<CalendarResponse>("/api/payments/calendar", { query: { month } }),
  });

  const byDate = new Map((data?.days ?? []).map((d) => [d.date, d]));

  const [year, monthNum] = month.split("-").map(Number);
  const firstOfMonth = new Date(Date.UTC(year!, monthNum! - 1, 1));
  const daysInMonth = new Date(Date.UTC(year!, monthNum!, 0)).getUTCDate();
  const leadingBlanks = firstOfMonth.getUTCDay();

  const cells: Array<{ label: string; day: CalendarDay | null } | null> = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const label = `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ label, day: byDate.get(label) ?? null });
  }

  const totalCount = data?.days.reduce((sum, d) => sum + d.count, 0) ?? 0;
  const totalAmount = data?.days.reduce((sum, d) => sum + Number(d.amount), 0) ?? 0;

  return (
    <div>
      <PageHeader title="月曆" subtitle="有未還期數的日子會標示件數與金額，點進去可看當天名單" />

      <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <button className="btn-secondary" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            ← 上個月
          </button>
          <span className="tabular text-lg font-semibold">{month}</span>
          <button className="btn-secondary" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            下個月 →
          </button>
          <button className="btn-secondary text-xs" onClick={() => setMonth(currentMonth())}>
            回到本月
          </button>
        </div>
        {data && (
          <div className="text-sm text-slate-500">
            本月未還 <span className="tabular font-semibold text-slate-900">{totalCount}</span> 期，合計{" "}
            <span className="tabular font-semibold text-rose-700">{money(totalAmount)}</span>
          </div>
        )}
      </div>

      <ErrorBanner error={error} />
      {isLoading ? (
        <Loading />
      ) : (
        <div className="card overflow-hidden p-4">
          <div className="grid grid-cols-7 gap-2 text-center text-xs font-medium text-slate-400">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-1">
                {w}
              </div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-2">
            {cells.map((cell, index) =>
              cell === null ? (
                <div key={`blank-${index}`} />
              ) : (
                <Link
                  key={cell.label}
                  to={`/collections/schedule?from=${cell.label}&to=${cell.label}`}
                  className={`flex min-h-20 flex-col rounded-lg border p-2 text-left text-xs transition ${
                    cell.day
                      ? "border-rose-200 bg-rose-50 hover:bg-rose-100"
                      : "border-slate-100 hover:bg-slate-50"
                  }`}
                >
                  <span className="tabular font-medium text-slate-700">{Number(cell.label.slice(-2))}</span>
                  {cell.day && (
                    <span className="mt-1 space-y-0.5">
                      <span className="block font-semibold text-rose-700">{cell.day.count} 期</span>
                      <span className="tabular block text-rose-600">{money(cell.day.amount)}</span>
                    </span>
                  )}
                </Link>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
