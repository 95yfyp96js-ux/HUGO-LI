import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { date, dateTime, money, percent } from "../lib/format";
import {
  DataTable,
  ErrorBanner,
  Field,
  KpiCard,
  Loading,
  Money,
  PageHeader,
  RiskGradeBadge,
  StatusBadge,
  Tabs,
} from "../components/ui";

interface Customer360 {
  profile: {
    id: string;
    customerNumber: string;
    name: string;
    identityNumberMasked: string;
    dateOfBirth: string;
    phone: string;
    email: string | null;
    address: string | null;
    employmentStatus: string | null;
    employer: string | null;
    monthlyIncome: string | null;
    status: string;
    createdAt: string;
  };
  summary: Record<string, string | number | null>;
  applications: Array<{
    id: string;
    applicationNumber: string;
    status: string;
    requestedAmount: string;
    requestedTermCount: number;
    productName: string | null;
    createdAt: string;
  }>;
  loans: Array<{
    id: string;
    loanNumber: string;
    status: string;
    principal: string;
    outstandingPrincipal: string;
    outstandingInterest: string;
    totalOutstanding: string;
    ratePercent: number | null;
    rateUnit: string | null;
    startDate: string | null;
    maturityDate: string | null;
    daysOverdue: number;
  }>;
  payments: Array<{
    id: string;
    paymentNumber: string;
    loanId: string;
    amount: string;
    method: string;
    status: string;
    paidAt: string;
    allocation: { principal: string; interest: string; fee: string } | null;
  }>;
  riskHistory: Array<{
    id: string;
    score: number;
    grade: string;
    decision: string;
    reasons: string[];
    createdAt: string;
  }>;
  collectionCases: Array<{
    id: string;
    caseNumber: string;
    loanId: string;
    status: string;
    priority: string;
    daysOverdue: number;
    outstandingAmount: string;
    activityCount: number;
    nextActionAt: string | null;
  }>;
}

const TABS = [
  { id: "overview", label: "總覽" },
  { id: "loans", label: "放款" },
  { id: "payments", label: "還款" },
  { id: "applications", label: "申請" },
  { id: "risk", label: "風險" },
  { id: "collections", label: "催收" },
];

export function CustomerDetailPage() {
  const { id } = useParams();
  const [tab, setTab] = useState("overview");

  const { data, isLoading, error } = useQuery({
    queryKey: ["customer360", id],
    queryFn: () => api<Customer360>(`/api/customers/${id}/360`),
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;
  if (!data) return null;

  const { profile, summary } = data;

  return (
    <div>
      <PageHeader
        title={`${profile.name}`}
        subtitle={`${profile.customerNumber} ・ ${profile.identityNumberMasked}`}
        actions={
          <>
            <Link to={`/lending/applications/new?customerId=${profile.id}`} className="btn-primary">
              建立放款申請
            </Link>
            <Link to={`/payments/new?customerId=${profile.id}`} className="btn-secondary">
              收款
            </Link>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="目前總欠款" value={money(summary.totalOutstanding as string)} tone="danger" />
        <KpiCard label="剩餘本金" value={money(summary.outstandingPrincipal as string)} />
        <KpiCard label="歷史借款總額" value={money(summary.totalBorrowed as string)} />
        <KpiCard label="歷史還款總額" value={money(summary.totalRepaid as string)} tone="success" />
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">客戶資料</h2>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="狀態">
                <StatusBadge status={profile.status} />
              </Field>
              <Field label="風險等級">
                <RiskGradeBadge grade={summary.currentRiskGrade as string | null} />
              </Field>
              <Field label="電話">{profile.phone}</Field>
              <Field label="電子郵件">{profile.email ?? "—"}</Field>
              <Field label="出生日期">{date(profile.dateOfBirth)}</Field>
              <Field label="月收入">{money(profile.monthlyIncome)}</Field>
              <Field label="任職公司">{profile.employer ?? "—"}</Field>
              <Field label="建檔日期">{date(profile.createdAt)}</Field>
              <div className="col-span-2">
                <Field label="地址">{profile.address ?? "—"}</Field>
              </div>
            </dl>
          </div>

          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">往來摘要</h2>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="活躍放款">{summary.activeLoanCount} 件</Field>
              <Field label="已結清放款">{summary.paidOffLoanCount} 件</Field>
              <Field label="逾期放款">{summary.overdueLoanCount} 件</Field>
              <Field label="平均逾期天數">{summary.averageDaysLate} 天</Field>
              <Field label="已付利息">{money(summary.interestPaid as string)}</Field>
              <Field label="應收利息">{money(summary.outstandingInterest as string)}</Field>
              <Field label="續借次數">{summary.renewalCount} 次</Field>
              <Field label="展期次數">{summary.extensionCount} 次</Field>
              <Field label="最近還款">{dateTime(summary.lastPaymentAt as string | null)}</Field>
              <Field label="最近還款金額">{money(summary.lastPaymentAmount as string | null)}</Field>
            </dl>
          </div>
        </div>
      )}

      {tab === "loans" && (
        <DataTable
          rows={data.loans}
          rowKey={(row) => row.id}
          empty="此客戶尚無放款紀錄"
          columns={[
            {
              header: "放款編號",
              cell: (row) => (
                <Link to={`/loans/${row.id}`} className="font-medium text-brand-600 hover:underline">
                  {row.loanNumber}
                </Link>
              ),
            },
            { header: "狀態", cell: (row) => <StatusBadge status={row.status} /> },
            { header: "放款金額", cell: (row) => <Money value={row.principal} />, className: "text-right" },
            {
              header: "剩餘本金",
              cell: (row) => <Money value={row.outstandingPrincipal} />,
              className: "text-right",
            },
            {
              header: "總欠款",
              cell: (row) => <Money value={row.totalOutstanding} className="font-medium" />,
              className: "text-right",
            },
            { header: "利率", cell: (row) => percent(row.ratePercent, row.rateUnit ?? undefined) },
            { header: "到期日", cell: (row) => date(row.maturityDate) },
            {
              header: "逾期天數",
              cell: (row) =>
                row.daysOverdue > 0 ? (
                  <span className="tabular font-medium text-rose-600">{row.daysOverdue}</span>
                ) : (
                  "—"
                ),
            },
          ]}
        />
      )}

      {tab === "payments" && (
        <DataTable
          rows={data.payments}
          rowKey={(row) => row.id}
          empty="尚無還款紀錄"
          columns={[
            { header: "收款編號", cell: (row) => <span className="tabular">{row.paymentNumber}</span> },
            { header: "日期", cell: (row) => dateTime(row.paidAt) },
            { header: "金額", cell: (row) => <Money value={row.amount} className="font-medium" />, className: "text-right" },
            { header: "本金", cell: (row) => <Money value={row.allocation?.principal} />, className: "text-right" },
            { header: "利息", cell: (row) => <Money value={row.allocation?.interest} />, className: "text-right" },
            { header: "費用", cell: (row) => <Money value={row.allocation?.fee} />, className: "text-right" },
            { header: "方式", cell: (row) => row.method },
            { header: "狀態", cell: (row) => <StatusBadge status={row.status} /> },
            {
              header: "放款",
              cell: (row) => (
                <Link to={`/loans/${row.loanId}`} className="text-brand-600 hover:underline">
                  查看
                </Link>
              ),
            },
          ]}
        />
      )}

      {tab === "applications" && (
        <DataTable
          rows={data.applications}
          rowKey={(row) => row.id}
          empty="尚無申請紀錄"
          columns={[
            {
              header: "申請編號",
              cell: (row) => (
                <Link
                  to={`/lending/applications/${row.id}`}
                  className="font-medium text-brand-600 hover:underline"
                >
                  {row.applicationNumber}
                </Link>
              ),
            },
            { header: "產品", cell: (row) => row.productName ?? "（無範本，放款單）" },
            { header: "申請金額", cell: (row) => <Money value={row.requestedAmount} />, className: "text-right" },
            { header: "期數", cell: (row) => `${row.requestedTermCount} 期` },
            { header: "狀態", cell: (row) => <StatusBadge status={row.status} kind="application" /> },
            { header: "申請日", cell: (row) => date(row.createdAt) },
          ]}
        />
      )}

      {tab === "risk" && (
        <div className="space-y-3">
          {data.riskHistory.length === 0 && (
            <div className="card p-8 text-center text-sm text-slate-500">尚無風險評估紀錄</div>
          )}
          {data.riskHistory.map((assessment) => (
            <div key={assessment.id} className="card p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <RiskGradeBadge grade={assessment.grade} />
                  <span className="tabular text-lg font-semibold">{assessment.score} 分</span>
                  <span className="text-sm text-slate-500">{assessment.decision}</span>
                </div>
                <span className="text-xs text-slate-500">{dateTime(assessment.createdAt)}</span>
              </div>
              <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-slate-600">
                {assessment.reasons.map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {tab === "collections" && (
        <DataTable
          rows={data.collectionCases}
          rowKey={(row) => row.id}
          empty="尚無催收案件"
          columns={[
            {
              header: "案件編號",
              cell: (row) => (
                <Link to={`/collections/${row.id}`} className="font-medium text-brand-600 hover:underline">
                  {row.caseNumber}
                </Link>
              ),
            },
            { header: "狀態", cell: (row) => <StatusBadge status={row.status} kind="collection" /> },
            { header: "優先度", cell: (row) => <StatusBadge status={row.priority} kind="priority" /> },
            { header: "逾期天數", cell: (row) => <span className="tabular">{row.daysOverdue}</span> },
            { header: "欠款", cell: (row) => <Money value={row.outstandingAmount} />, className: "text-right" },
            { header: "催收次數", cell: (row) => `${row.activityCount} 次` },
            { header: "下次追蹤", cell: (row) => date(row.nextActionAt) },
          ]}
        />
      )}
    </div>
  );
}
