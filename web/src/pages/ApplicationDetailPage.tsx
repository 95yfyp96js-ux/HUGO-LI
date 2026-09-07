import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { date, dateTime, money, percent, REPAYMENT_METHOD_LABELS } from "../lib/format";
import {
  ErrorBanner,
  Field,
  Loading,
  PageHeader,
  RiskGradeBadge,
  StatusBadge,
} from "../components/ui";
import { useAuth } from "../lib/auth";

interface ApplicationDetail {
  id: string;
  applicationNumber: string;
  status: string;
  requestedAmountCents: number;
  requestedTermMonths: number;
  purpose: string | null;
  incomeCents: number | null;
  existingDebtCents: number | null;
  createdAt: string;
  customer: {
    id: string;
    name: string;
    customerNumber: string;
    phone: string;
    monthlyIncomeCents: number | null;
    employer: string | null;
    status: string;
  };
  requestedProduct: { id: string; name: string; ratePercent: number; rateUnit: string };
  riskAssessments: Array<{
    id: string;
    score: number;
    grade: string;
    decision: string;
    reasons: string;
    modelVersion: string;
    createdAt: string;
    factors: Array<{ code: string; label: string; value: string; points: number }>;
  }>;
  lendingLimits: Array<{
    id: string;
    maximumLimitCents: number;
    currentExposureCents: number;
    availableLimitCents: number;
    recommendedAmountCents: number;
    decision: string;
    reasons: string;
  }>;
  loanOffers: Array<{
    id: string;
    approvedAmountCents: number;
    ratePercent: number;
    rateUnit: string;
    termMonths: number;
    feesCents: number;
    repaymentMethod: string;
    totalInterestCents: number;
    totalPayableCents: number;
    pricingVersion: string;
  }>;
  approvals: Array<{
    id: string;
    decision: string;
    approvedAmountCents: number | null;
    reason: string | null;
    approvedAt: string | null;
  }>;
  loan: { id: string; loanNumber: string; status: string } | null;
}

export function ApplicationDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["application", id],
    queryFn: () => api<ApplicationDetail>(`/api/lending/applications/${id}`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["application", id] });
    queryClient.invalidateQueries({ queryKey: ["applications"] });
  };

  const submitMutation = useMutation({
    mutationFn: () => api(`/api/lending/applications/${id}/submit`, { method: "POST" }),
    onSuccess: invalidate,
  });

  const approveMutation = useMutation({
    mutationFn: () =>
      api(`/api/lending/applications/${id}/approve`, {
        method: "POST",
        body: { reason: "符合授信條件" },
      }),
    onSuccess: invalidate,
  });

  const rejectMutation = useMutation({
    mutationFn: () =>
      api(`/api/lending/applications/${id}/reject`, { method: "POST", body: { reason: rejectReason } }),
    onSuccess: () => {
      setShowReject(false);
      invalidate();
    },
  });

  const createLoanMutation = useMutation({
    mutationFn: () => api<{ id: string }>("/api/loans", { method: "POST", body: { applicationId: id } }),
    onSuccess: (loan) => navigate(`/loans/${loan.id}`),
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;
  if (!data) return null;

  const risk = data.riskAssessments[0];
  const limit = data.lendingLimits[0];
  const offer = data.loanOffers[0];
  const approval = data.approvals[0];
  const reasons: string[] = risk ? JSON.parse(risk.reasons) : [];
  const limitReasons: string[] = limit ? JSON.parse(limit.reasons) : [];

  const canDecide = ["UNDER_REVIEW", "RISK_REVIEW"].includes(data.status);

  return (
    <div>
      <PageHeader
        title={data.applicationNumber}
        subtitle={`${data.customer.name}（${data.customer.customerNumber}）`}
        actions={
          <>
            {data.status === "DRAFT" && can("APPLICATION_UPDATE") && (
              <button
                className="btn-primary"
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
              >
                {submitMutation.isPending ? "審核中…" : "送出申請（執行風控）"}
              </button>
            )}
            {canDecide && can("APPLICATION_APPROVE") && (
              <button
                className="btn-primary"
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending || !offer}
              >
                核准
              </button>
            )}
            {canDecide && can("APPLICATION_REJECT") && (
              <button className="btn-danger" onClick={() => setShowReject(true)}>
                婉拒
              </button>
            )}
            {data.status === "APPROVED" && !data.loan && can("LOAN_CREATE") && (
              <button
                className="btn-primary"
                onClick={() => createLoanMutation.mutate()}
                disabled={createLoanMutation.isPending}
              >
                {createLoanMutation.isPending ? "建立中…" : "建立放款"}
              </button>
            )}
            {data.loan && (
              <Link to={`/loans/${data.loan.id}`} className="btn-secondary">
                前往放款 {data.loan.loanNumber}
              </Link>
            )}
          </>
        }
      />

      <ErrorBanner
        error={
          submitMutation.error ?? approveMutation.error ?? rejectMutation.error ?? createLoanMutation.error
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <StatusBadge status={data.status} kind="application" />
        {risk && <RiskGradeBadge grade={risk.grade} />}
        <span className="text-sm text-slate-500">申請日 {date(data.createdAt)}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">申請內容</h2>
          <dl className="grid grid-cols-2 gap-4">
            <Field label="申請金額">{money(data.requestedAmountCents / 100)}</Field>
            <Field label="申請期數">{data.requestedTermMonths} 期</Field>
            <Field label="產品">{data.requestedProduct.name}</Field>
            <Field label="產品利率">
              {percent(data.requestedProduct.ratePercent, data.requestedProduct.rateUnit)}
            </Field>
            <Field label="申報月收入">{money(data.incomeCents ? data.incomeCents / 100 : null)}</Field>
            <Field label="現有負債">
              {money(data.existingDebtCents ? data.existingDebtCents / 100 : null)}
            </Field>
            <div className="col-span-2">
              <Field label="借款用途">{data.purpose ?? "—"}</Field>
            </div>
          </dl>

          <h2 className="mb-3 mt-6 text-sm font-semibold text-slate-700">客戶概況</h2>
          <dl className="grid grid-cols-2 gap-4">
            <Field label="客戶狀態">
              <StatusBadge status={data.customer.status} />
            </Field>
            <Field label="電話">{data.customer.phone}</Field>
            <Field label="任職公司">{data.customer.employer ?? "—"}</Field>
            <Field label="登錄月收入">
              {money(data.customer.monthlyIncomeCents ? data.customer.monthlyIncomeCents / 100 : null)}
            </Field>
            <div className="col-span-2">
              <Link to={`/customers/${data.customer.id}`} className="text-sm text-brand-600 hover:underline">
                查看客戶 360 →
              </Link>
            </div>
          </dl>
        </div>

        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">風險評估</h2>
            {risk ? (
              <>
                <div className="mb-3 flex items-center gap-3">
                  <RiskGradeBadge grade={risk.grade} />
                  <span className="tabular text-xl font-semibold">{risk.score} 分</span>
                  <span className="text-sm text-slate-500">{risk.decision}</span>
                </div>
                <ul className="mb-4 list-inside list-disc space-y-1 text-sm text-slate-600">
                  {reasons.map((reason, index) => (
                    <li key={index}>{reason}</li>
                  ))}
                </ul>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {risk.factors.map((factor) => (
                      <tr key={factor.code}>
                        <td className="py-1.5 text-slate-600">{factor.label}</td>
                        <td className="py-1.5 text-right text-slate-500">{factor.value}</td>
                        <td
                          className={`tabular w-16 py-1.5 text-right font-medium ${
                            factor.points > 0
                              ? "text-rose-600"
                              : factor.points < 0
                                ? "text-emerald-600"
                                : "text-slate-400"
                          }`}
                        >
                          {factor.points > 0 ? `+${factor.points}` : factor.points}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-slate-400">模型版本 {risk.modelVersion}</p>
              </>
            ) : (
              <p className="text-sm text-slate-500">尚未執行風險評估，請先送出申請。</p>
            )}
          </div>

          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">放款額度</h2>
            {limit ? (
              <>
                <dl className="grid grid-cols-2 gap-4">
                  <Field label="核定上限">{money(limit.maximumLimitCents / 100)}</Field>
                  <Field label="目前曝險">{money(limit.currentExposureCents / 100)}</Field>
                  <Field label="可動用額度">{money(limit.availableLimitCents / 100)}</Field>
                  <Field label="建議金額">
                    <span className="font-semibold text-brand-700">
                      {money(limit.recommendedAmountCents / 100)}
                    </span>
                  </Field>
                </dl>
                <div className="mt-3">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                      limit.decision === "LIMIT_AVAILABLE"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-rose-50 text-rose-700"
                    }`}
                  >
                    {limit.decision === "LIMIT_AVAILABLE" ? "額度足夠" : "超過額度"}
                  </span>
                </div>
                <ul className="mt-3 list-inside list-disc space-y-1 text-xs text-slate-500">
                  {limitReasons.map((reason, index) => (
                    <li key={index}>{reason}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-slate-500">尚未計算額度。</p>
            )}
          </div>

          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">放款條件（定價結果）</h2>
            {offer ? (
              <dl className="grid grid-cols-2 gap-4">
                <Field label="核准金額">{money(offer.approvedAmountCents / 100)}</Field>
                <Field label="放款利率">{percent(offer.ratePercent, offer.rateUnit)}</Field>
                <Field label="期數">{offer.termMonths} 期</Field>
                <Field label="還款方式">
                  {REPAYMENT_METHOD_LABELS[offer.repaymentMethod] ?? offer.repaymentMethod}
                </Field>
                <Field label="總利息">{money(offer.totalInterestCents / 100)}</Field>
                <Field label="費用">{money(offer.feesCents / 100)}</Field>
                <div className="col-span-2 border-t border-slate-200 pt-3">
                  <Field label="總應還">
                    <span className="text-lg font-semibold">{money(offer.totalPayableCents / 100)}</span>
                  </Field>
                </div>
                <p className="col-span-2 text-xs text-slate-400">定價版本 {offer.pricingVersion}</p>
              </dl>
            ) : (
              <p className="text-sm text-slate-500">尚未產生放款條件。</p>
            )}
          </div>

          {approval && (
            <div className="card p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">審核決定</h2>
              <dl className="grid grid-cols-2 gap-4">
                <Field label="決定">{approval.decision}</Field>
                <Field label="核准金額">
                  {money(approval.approvedAmountCents ? approval.approvedAmountCents / 100 : null)}
                </Field>
                <Field label="時間">{dateTime(approval.approvedAt)}</Field>
                <div className="col-span-2">
                  <Field label="原因">{approval.reason ?? "—"}</Field>
                </div>
              </dl>
            </div>
          )}
        </div>
      </div>

      {showReject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6">
            <h2 className="text-lg font-semibold">婉拒申請</h2>
            <p className="mt-1 text-sm text-slate-500">婉拒原因會記錄於稽核軌跡，無法事後修改。</p>
            <textarea
              className="input mt-4"
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="請說明婉拒原因"
            />
            <ErrorBanner error={rejectMutation.error} />
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShowReject(false)}>
                取消
              </button>
              <button
                className="btn-danger"
                onClick={() => rejectMutation.mutate()}
                disabled={!rejectReason.trim() || rejectMutation.isPending}
              >
                確認婉拒
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
