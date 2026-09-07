import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { money } from "../lib/format";
import { ErrorBanner, KpiCard, Loading, PageHeader, Tabs } from "../components/ui";

interface Summary {
  outstandingPrincipal: string;
  outstandingInterest: string;
  totalOutstanding: string;
  activeLoanCount: number;
  totalLoanCount: number;
  paidOffLoanCount: number;
  overdueLoanCount: number;
  overduePrincipal: string;
  totalDisbursed: string;
  totalCollected: string;
  averageLoanSize: string;
  averageDaysLate: number;
  collectionRate: string;
  par: Record<string, string>;
}

interface TrendPoint {
  date: string;
  disbursed: string;
  collected: string;
}

const TABS = [
  { id: "portfolio", label: "資產組合" },
  { id: "trend", label: "放款／收款趨勢" },
  { id: "risk", label: "風險分布" },
];

export function ReportsPage() {
  const [tab, setTab] = useState("portfolio");
  const [days, setDays] = useState(30);

  const { data: summary, isLoading, error } = useQuery({
    queryKey: ["portfolio-summary"],
    queryFn: () => api<Summary>("/api/portfolio/summary"),
  });

  const { data: trend } = useQuery({
    queryKey: ["portfolio-trend", days],
    queryFn: () => api<{ items: TrendPoint[] }>("/api/portfolio/trend", { query: { days } }),
    enabled: tab === "trend",
  });

  const { data: byGrade } = useQuery({
    queryKey: ["portfolio-by-risk-grade"],
    queryFn: () =>
      api<{ items: Array<{ grade: string; loanCount: number; outstanding: string }> }>(
        "/api/portfolio/by-risk-grade"
      ),
    enabled: tab === "risk",
  });

  /** CSV export runs client-side over data the API already returned. */
  function exportCsv(filename: string, rows: Array<Record<string, string | number>>) {
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]!);
    const csv = [
      headers.join(","),
      ...rows.map((row) => headers.map((header) => `"${String(row[header] ?? "")}"`).join(",")),
    ].join("\n");
    // BOM so Excel opens UTF-8 Chinese correctly.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;
  if (!summary) return null;

  return (
    <div>
      <PageHeader title="報表" subtitle="所有數字由後端依實際紀錄計算" />
      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "portfolio" && (
        <>
          <div className="mb-4 flex justify-end">
            <button
              className="btn-secondary text-xs"
              onClick={() =>
                exportCsv("portfolio-report.csv", [
                  { 項目: "放款本金餘額", 金額: summary.outstandingPrincipal },
                  { 項目: "應收利息", 金額: summary.outstandingInterest },
                  { 項目: "總放款餘額", 金額: summary.totalOutstanding },
                  { 項目: "逾期本金", 金額: summary.overduePrincipal },
                  { 項目: "累計撥款", 金額: summary.totalDisbursed },
                  { 項目: "累計收款", 金額: summary.totalCollected },
                  { 項目: "PAR7", 金額: summary.par.par7! },
                  { 項目: "PAR30", 金額: summary.par.par30! },
                  { 項目: "PAR60", 金額: summary.par.par60! },
                  { 項目: "PAR90", 金額: summary.par.par90! },
                ])
              }
            >
              匯出 CSV
            </button>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="放款本金餘額" value={money(summary.outstandingPrincipal)} />
            <KpiCard label="應收利息" value={money(summary.outstandingInterest)} />
            <KpiCard label="累計撥款" value={money(summary.totalDisbursed)} />
            <KpiCard label="累計收款" value={money(summary.totalCollected)} tone="success" />
            <KpiCard label="活躍放款" value={`${summary.activeLoanCount} 件`} />
            <KpiCard label="已結清" value={`${summary.paidOffLoanCount} 件`} />
            <KpiCard label="逾期件數" value={`${summary.overdueLoanCount} 件`} tone="danger" />
            <KpiCard label="回收率" value={`${summary.collectionRate}%`} />
          </div>

          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">資產品質</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th className="py-2 text-left">指標</th>
                  <th className="py-2 text-right">餘額</th>
                  <th className="py-2 text-right">佔比</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(["par7", "par30", "par60", "par90"] as const).map((key) => (
                  <tr key={key}>
                    <td className="py-2">{key.toUpperCase()}</td>
                    <td className="tabular py-2 text-right">{money(summary.par[key])}</td>
                    <td className="tabular py-2 text-right">{summary.par[`${key}Ratio`]}%</td>
                  </tr>
                ))}
                <tr>
                  <td className="py-2">平均放款金額</td>
                  <td className="tabular py-2 text-right">{money(summary.averageLoanSize)}</td>
                  <td className="py-2" />
                </tr>
                <tr>
                  <td className="py-2">平均逾期天數</td>
                  <td className="tabular py-2 text-right">{summary.averageDaysLate} 天</td>
                  <td className="py-2" />
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "trend" && (
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">放款與收款趨勢</h2>
            <div className="flex gap-2">
              {[7, 30, 90].map((option) => (
                <button
                  key={option}
                  onClick={() => setDays(option)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    days === option ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {option} 天
                </button>
              ))}
              <button
                className="btn-secondary py-1 text-xs"
                onClick={() => exportCsv("trend-report.csv", (trend?.items ?? []) as never)}
              >
                匯出 CSV
              </button>
            </div>
          </div>

          {!trend ? (
            <Loading />
          ) : (
            <TrendChart points={trend.items} />
          )}
        </div>
      )}

      {tab === "risk" && (
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">風險等級分布</h2>
            <button
              className="btn-secondary py-1 text-xs"
              onClick={() => exportCsv("risk-report.csv", (byGrade?.items ?? []) as never)}
            >
              匯出 CSV
            </button>
          </div>
          {!byGrade ? (
            <Loading />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th className="py-2 text-left">風險等級</th>
                  <th className="py-2 text-right">件數</th>
                  <th className="py-2 text-right">放款餘額</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {byGrade.items.map((bucket) => (
                  <tr key={bucket.grade}>
                    <td className="py-2 font-medium">{bucket.grade}</td>
                    <td className="tabular py-2 text-right">{bucket.loanCount}</td>
                    <td className="tabular py-2 text-right">{money(bucket.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/** Minimal inline bar chart — no charting dependency for two series. */
function TrendChart({ points }: { points: TrendPoint[] }) {
  const max = Math.max(
    1,
    ...points.map((p) => Math.max(Number(p.disbursed), Number(p.collected)))
  );

  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-brand-500" /> 放款
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-emerald-500" /> 收款
        </span>
      </div>
      <div className="flex h-48 items-end gap-0.5 overflow-x-auto">
        {points.map((point) => (
          <div key={point.date} className="flex min-w-[6px] flex-1 flex-col justify-end gap-0.5" title={point.date}>
            <div
              className="w-full rounded-t-sm bg-brand-500"
              style={{ height: `${(Number(point.disbursed) / max) * 100}%` }}
            />
            <div
              className="w-full rounded-t-sm bg-emerald-500"
              style={{ height: `${(Number(point.collected) / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-slate-400">
        <span>{points[0]?.date}</span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </div>
  );
}
