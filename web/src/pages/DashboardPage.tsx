import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { money } from "../lib/format";
import { ErrorBanner, KpiCard, Loading, PageHeader, RiskGradeBadge } from "../components/ui";

interface DashboardResponse {
  summary: {
    outstandingPrincipal: string;
    outstandingInterest: string;
    totalOutstanding: string;
    activeLoanCount: number;
    overdueLoanCount: number;
    overduePrincipal: string;
    dueTodayCount: number;
    dueTodayAmount: string;
    pendingApprovalCount: number;
    pendingDisbursementCount: number;
    disbursingCount: number;
    todayDisbursement: string;
    todayCollection: string;
    monthDisbursement: string;
    monthCollection: string;
    averageLoanSize: string;
    averageDaysLate: number;
    collectionRate: string;
    par: Record<string, string>;
  };
  dailyClose: {
    date: string;
    dueCount: number;
    dueAmount: string;
    collectedCount: number;
    collectedAmount: string;
    uncollectedAmount: string;
  };
  byRiskGrade: Array<{ grade: string; loanCount: number; outstanding: string }>;
  collections: {
    openCases: number;
    overdueAmount: string;
    highRiskCases: number;
    pendingPromises: number;
    todayFollowUps: number;
    recoveredAmount: string;
  };
}

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<DashboardResponse>("/api/dashboard"),
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;
  if (!data) return null;

  const { summary, byRiskGrade, collections, dailyClose } = data;

  return (
    <div>
      <PageHeader
        title="放款營運總覽"
        subtitle="所有數字皆由後端引擎依實際交易紀錄計算，可點擊下鑽至原始資料"
        actions={
          <>
            <Link to="/loans/new" className="btn-primary">
              新增放款
            </Link>
            <Link to="/payments/new" className="btn-secondary">
              快速收款
            </Link>
          </>
        }
      />

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          早會 · {dailyClose.date}（Asia/Taipei 日結）
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <KpiCard
            label="今日應收"
            value={money(dailyClose.dueAmount)}
            sub={`${dailyClose.dueCount} 筆`}
            to="/payments/due-today"
            tone="warning"
          />
          <KpiCard
            label="今日未收"
            value={money(dailyClose.uncollectedAmount)}
            to="/payments/due-today"
            tone="danger"
          />
          <KpiCard
            label="今日實收"
            value={money(dailyClose.collectedAmount)}
            sub={`${dailyClose.collectedCount} 筆`}
            to="/payments"
            tone="success"
          />
          <KpiCard
            label="逾期件數"
            value={String(summary.overdueLoanCount)}
            sub="件"
            to="/loans/overdue"
            tone="danger"
          />
          <KpiCard
            label="待撥件數"
            value={String(summary.pendingDisbursementCount)}
            sub="件"
            to="/loans/pending-disbursement"
          />
          <KpiCard
            label="撥款處理中"
            value={String(summary.disbursingCount)}
            sub="DISBURSING"
            to="/loans/pending-disbursement"
          />
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">今日營運</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="今日放款" value={money(summary.todayDisbursement)} to="/loans" />
          <KpiCard label="今日收款" value={money(summary.todayCollection)} to="/payments" tone="success" />
          <KpiCard
            label="今日應收"
            value={money(summary.dueTodayAmount)}
            sub={`${summary.dueTodayCount} 筆到期`}
            to="/loans?status=DUE"
            tone="warning"
          />
          <KpiCard
            label="逾期金額"
            value={money(summary.overduePrincipal)}
            sub={`${summary.overdueLoanCount} 件逾期`}
            to="/loans/overdue"
            tone="danger"
          />
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">放款餘額</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="放款本金餘額" value={money(summary.outstandingPrincipal)} to="/loans" />
          <KpiCard label="應收利息" value={money(summary.outstandingInterest)} to="/loans" />
          <KpiCard
            label="活躍放款件數"
            value={String(summary.activeLoanCount)}
            sub={`平均 ${money(summary.averageLoanSize)}`}
            to="/loans"
          />
          <KpiCard
            label="待撥款 / 待審核"
            value={`${summary.pendingDisbursementCount} / ${summary.pendingApprovalCount}`}
            sub="件"
            to="/loans/pending-disbursement"
          />
        </div>
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">本月累計</h2>
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs text-slate-500">本月放款</dt>
              <dd className="tabular mt-1 text-xl font-semibold">{money(summary.monthDisbursement)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">本月收款</dt>
              <dd className="tabular mt-1 text-xl font-semibold text-emerald-600">
                {money(summary.monthCollection)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">回收率</dt>
              <dd className="tabular mt-1 text-xl font-semibold">{summary.collectionRate}%</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">平均逾期天數</dt>
              <dd className="tabular mt-1 text-xl font-semibold">{summary.averageDaysLate} 天</dd>
            </div>
          </dl>
        </div>

        <div className="card p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">
            資產品質 PAR（逾期超過 N 日之放款餘額）
          </h2>
          <div className="space-y-3">
            {(["par7", "par30", "par60", "par90"] as const).map((key) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-sm text-slate-600">{key.toUpperCase()}</span>
                <div className="flex items-center gap-3">
                  <span className="tabular text-sm font-medium">{money(summary.par[key])}</span>
                  <span className="tabular w-14 text-right text-xs text-slate-500">
                    {summary.par[`${key}Ratio`]}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">風險等級分布</h2>
            <Link to="/loans" className="text-xs text-brand-600 hover:underline">
              查看放款
            </Link>
          </div>
          {byRiskGrade.length === 0 ? (
            <p className="text-sm text-slate-500">尚無資料</p>
          ) : (
            <div className="space-y-2">
              {byRiskGrade.map((bucket) => (
                <div key={bucket.grade} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RiskGradeBadge grade={bucket.grade === "UNGRADED" ? null : bucket.grade} />
                    <span className="text-sm text-slate-600">{bucket.loanCount} 件</span>
                  </div>
                  <span className="tabular text-sm font-medium">{money(bucket.outstanding)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">催收概況</h2>
            <Link to="/collections" className="text-xs text-brand-600 hover:underline">
              前往催收
            </Link>
          </div>
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs text-slate-500">催收案件</dt>
              <dd className="tabular mt-1 text-xl font-semibold">{collections.openCases}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">高風險案件</dt>
              <dd className="tabular mt-1 text-xl font-semibold text-rose-600">
                {collections.highRiskCases}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">今日待追蹤</dt>
              <dd className="tabular mt-1 text-xl font-semibold text-amber-600">
                {collections.todayFollowUps}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">還款承諾</dt>
              <dd className="tabular mt-1 text-xl font-semibold">{collections.pendingPromises}</dd>
            </div>
          </dl>
        </div>
      </section>
    </div>
  );
}
