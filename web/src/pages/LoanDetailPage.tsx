import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, newIdempotencyKey } from "../lib/api";
import { date, dateTime, money, percent, REPAYMENT_METHOD_LABELS , termNoun, termSuffix} from "../lib/format";
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
import { useAuth } from "../lib/auth";

interface LoanDetail {
  id: string;
  loanNumber: string;
  status: string;
  principalCents: number;
  outstandingPrincipalCents: number;
  outstandingInterestCents: number;
  outstandingFeeCents: number;
  startDate: string | null;
  maturityDate: string | null;
  customer: { id: string; name: string; customerNumber: string; phone: string };
  snapshot: {
    ratePercent: number;
    rateUnit: string;
    termCount: number;
    termUnit: string;
    repaymentMethod: string;
    calculationMethod: string;
    productVersion: number;
    pricingVersion: string;
    createdAt: string;
  } | null;
  scheduleLines: Array<{
    id: string;
    installmentNumber: number;
    dueDate: string;
    principalDueCents: number;
    interestDueCents: number;
    feeDueCents: number;
    totalDueCents: number;
    principalPaidCents: number;
    interestPaidCents: number;
    feePaidCents: number;
    status: string;
  }>;
  payments: Array<{
    id: string;
    paymentNumber: string;
    amountCents: number;
    method: string;
    status: string;
    paidAt: string;
    allocations: Array<{ principalAmountCents: number; interestAmountCents: number; feeAmountCents: number }>;
  }>;
  disbursements: Array<{
    id: string;
    disbursementNumber: string;
    amountCents: number;
    method: string;
    status: string;
    reference: string | null;
    processedAt: string | null;
  }>;
  moneyEvents: Array<{
    id: string;
    type: string;
    amountCents: number;
    occurredAt: string;
    metadata: string;
  }>;
  extensions: Array<{
    id: string;
    previousMaturityDate: string;
    newMaturityDate: string;
    extensionMonths: number;
    feeCents: number;
    reason: string;
    createdAt: string;
  }>;
  settlement: { totalPaidCents: number; settledAt: string } | null;
  collectionCases: Array<{ id: string; caseNumber: string; status: string; priority: string; daysOverdue: number }>;
  application: { id: string; riskAssessments: Array<{ grade: string; score: number; decision: string }> } | null;
}

interface Balance {
  outstandingPrincipal: string;
  outstandingInterest: string;
  outstandingFees: string;
  totalOutstanding: string;
  totalPaid: string;
  principalPaid: string;
  interestPaid: string;
  feesPaid: string;
}

interface Chain {
  originalLoanId: string;
  chain: Array<{
    loanId: string;
    loanNumber: string;
    status: string;
    principal: string;
    sequence: number;
    renewedFrom?: string;
    reason?: string;
  }>;
}

const TABS = [
  { id: "overview", label: "放款總覽" },
  { id: "schedule", label: "還款期程" },
  { id: "payments", label: "收款紀錄" },
  { id: "balance", label: "餘額" },
  { id: "events", label: "金流事件" },
  { id: "chain", label: "續借鏈" },
  { id: "collection", label: "催收" },
];

const EVENT_LABELS: Record<string, string> = {
  DISBURSEMENT: "撥款",
  INTEREST_ACCRUAL: "計息",
  FEE_CHARGE: "收費",
  PAYMENT: "收款",
  PAYMENT_REVERSAL: "收款沖銷",
  ADJUSTMENT: "調整",
  WRITE_OFF: "呆帳沖銷",
  SETTLEMENT: "結清",
};

export function LoanDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("overview");
  const [action, setAction] = useState<"renew" | "extend" | null>(null);
  const [confirmingInstallment, setConfirmingInstallment] = useState<number | null>(null);

  const { data: loan, isLoading, error } = useQuery({
    queryKey: ["loan", id],
    queryFn: () => api<LoanDetail>(`/api/loans/${id}`),
  });

  const confirmInstallment = useMutation({
    mutationFn: (installmentNumber: number) => {
      setConfirmingInstallment(installmentNumber);
      return api(`/api/loans/${id}/installments/${installmentNumber}/confirm`, {
        method: "POST",
        idempotencyKey: newIdempotencyKey(),
      });
    },
    onSettled: () => setConfirmingInstallment(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["loan", id] });
      queryClient.invalidateQueries({ queryKey: ["loan-balance", id] });
    },
  });

  const { data: balance } = useQuery({
    queryKey: ["loan-balance", id],
    queryFn: () => api<Balance>(`/api/loans/${id}/balance`),
    enabled: Boolean(id),
  });

  const { data: chain } = useQuery({
    queryKey: ["loan-chain", id],
    queryFn: () => api<Chain>(`/api/loans/${id}/chain`),
    enabled: Boolean(id) && tab === "chain",
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;
  if (!loan) return null;

  const totalOutstanding =
    (loan.outstandingPrincipalCents + loan.outstandingInterestCents + loan.outstandingFeeCents) / 100;
  const risk = loan.application?.riskAssessments[0];
  const isServicing = ["ACTIVE", "DUE_SOON", "DUE", "OVERDUE", "DEFAULTED"].includes(loan.status);

  return (
    <div>
      <PageHeader
        title={loan.loanNumber}
        subtitle={`${loan.customer.name}（${loan.customer.customerNumber}）`}
        actions={
          <>
            {isServicing && can("PAYMENT_CREATE") && (
              <Link to={`/payments/new?loanId=${loan.id}`} className="btn-primary">
                收款
              </Link>
            )}
            {isServicing && can("LOAN_RENEW") && (
              <button className="btn-secondary" onClick={() => setAction("renew")}>
                續借
              </button>
            )}
            {isServicing && can("LOAN_EXTEND") && (
              <button className="btn-secondary" onClick={() => setAction("extend")}>
                展期
              </button>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="放款金額" value={money(loan.principalCents / 100)} />
        <KpiCard label="剩餘本金" value={money(loan.outstandingPrincipalCents / 100)} />
        <KpiCard label="剩餘利息" value={money(loan.outstandingInterestCents / 100)} />
        <KpiCard
          label="總欠款"
          value={money(totalOutstanding)}
          tone={loan.status === "OVERDUE" ? "danger" : "default"}
        />
        <div className="card flex flex-col justify-center gap-2 p-4">
          <StatusBadge status={loan.status} />
          <div className="flex items-center gap-2 text-xs text-slate-500">
            風險 <RiskGradeBadge grade={risk?.grade ?? null} />
          </div>
        </div>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">
              放款條件快照（成立時鎖定，產品改價不影響本筆）
            </h2>
            {loan.snapshot ? (
              <dl className="grid grid-cols-2 gap-4">
                <Field label="利率">{percent(loan.snapshot.ratePercent, loan.snapshot.rateUnit)}</Field>
                <Field label={termNoun(loan.snapshot.termUnit)}>
                  {loan.snapshot.termCount} {termSuffix(loan.snapshot.termUnit)}
                </Field>
                <Field label="還款方式">
                  {REPAYMENT_METHOD_LABELS[loan.snapshot.repaymentMethod] ?? loan.snapshot.repaymentMethod}
                </Field>
                <Field label="計息方式">{loan.snapshot.calculationMethod}</Field>
                <Field label="產品版本">v{loan.snapshot.productVersion}</Field>
                <Field label="定價版本">{loan.snapshot.pricingVersion}</Field>
                <Field label="起始日">{date(loan.startDate)}</Field>
                <Field label="到期日">{date(loan.maturityDate)}</Field>
              </dl>
            ) : (
              <p className="text-sm text-slate-500">尚無快照</p>
            )}
          </div>

          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">撥款紀錄</h2>
            {loan.disbursements.length === 0 ? (
              <p className="text-sm text-slate-500">尚未撥款</p>
            ) : (
              <div className="space-y-3">
                {loan.disbursements.map((d) => (
                  <div key={d.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex justify-between">
                      <span className="font-medium">{d.disbursementNumber}</span>
                      <StatusBadge status={d.status === "COMPLETED" ? "PAID_OFF" : d.status} />
                    </div>
                    <div className="tabular mt-1 text-slate-600">{money(d.amountCents / 100)}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {d.method} ・ {dateTime(d.processedAt)}
                    </div>
                    {d.reference && (
                      <div className="mt-1 font-mono text-xs text-slate-400">{d.reference}</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {loan.extensions.length > 0 && (
              <>
                <h2 className="mb-3 mt-5 text-sm font-semibold text-slate-700">展期紀錄</h2>
                <div className="space-y-2">
                  {loan.extensions.map((e) => (
                    <div key={e.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                      <div>
                        {date(e.previousMaturityDate)} → {date(e.newMaturityDate)}（+{e.extensionMonths} 個月）
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        展期費 {money(e.feeCents / 100)} ・ {e.reason}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {loan.settlement && (
              <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
                <div className="font-medium text-emerald-800">已結清</div>
                <div className="tabular mt-1 text-emerald-700">
                  總還款 {money(loan.settlement.totalPaidCents / 100)}
                </div>
                <div className="mt-1 text-xs text-emerald-600">{dateTime(loan.settlement.settledAt)}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "schedule" && (
        <>
          <ErrorBanner error={confirmInstallment.error} />
          <DataTable
          rows={loan.scheduleLines}
          rowKey={(row) => row.id}
          empty="尚無還款期程"
          columns={[
            { header: "期數", cell: (row) => <span className="tabular">{row.installmentNumber}</span> },
            { header: "應繳日", cell: (row) => date(row.dueDate) },
            { header: "本金", cell: (row) => <Money value={row.principalDueCents / 100} />, className: "text-right" },
            { header: "利息", cell: (row) => <Money value={row.interestDueCents / 100} />, className: "text-right" },
            { header: "費用", cell: (row) => <Money value={row.feeDueCents / 100} />, className: "text-right" },
            {
              header: "應繳合計",
              cell: (row) => <Money value={row.totalDueCents / 100} className="font-medium" />,
              className: "text-right",
            },
            {
              header: "已繳",
              cell: (row) => (
                <Money value={(row.principalPaidCents + row.interestPaidCents + row.feePaidCents) / 100} />
              ),
              className: "text-right",
            },
            {
              header: "狀態",
              cell: (row) => (
                <span
                  className={`text-xs font-medium ${
                    row.status === "PAID"
                      ? "text-emerald-600"
                      : row.status === "OVERDUE"
                        ? "text-rose-600"
                        : row.status === "PARTIALLY_PAID"
                          ? "text-amber-600"
                          : "text-slate-500"
                  }`}
                >
                  {row.status === "PAID"
                    ? "已繳清"
                    : row.status === "OVERDUE"
                      ? "逾期"
                      : row.status === "PARTIALLY_PAID"
                        ? "部分繳納"
                        : "未到期"}
                </span>
              ),
            },
            {
              header: "",
              cell: (row) =>
                isServicing && can("PAYMENT_CREATE") && row.status !== "PAID" ? (
                  <button
                    className="btn-secondary text-xs"
                    disabled={confirmInstallment.isPending}
                    onClick={() => confirmInstallment.mutate(row.installmentNumber)}
                  >
                    {confirmingInstallment === row.installmentNumber ? "確認中…" : "回款確認"}
                  </button>
                ) : null,
            },
          ]}
          />
        </>
      )}

      {tab === "payments" && (
        <DataTable
          rows={loan.payments}
          rowKey={(row) => row.id}
          empty="尚無收款紀錄"
          columns={[
            { header: "收款編號", cell: (row) => <span className="tabular">{row.paymentNumber}</span> },
            { header: "收款日", cell: (row) => dateTime(row.paidAt) },
            {
              header: "金額",
              cell: (row) => <Money value={row.amountCents / 100} className="font-medium" />,
              className: "text-right",
            },
            {
              header: "本金",
              cell: (row) => <Money value={(row.allocations[0]?.principalAmountCents ?? 0) / 100} />,
              className: "text-right",
            },
            {
              header: "利息",
              cell: (row) => <Money value={(row.allocations[0]?.interestAmountCents ?? 0) / 100} />,
              className: "text-right",
            },
            {
              header: "費用",
              cell: (row) => <Money value={(row.allocations[0]?.feeAmountCents ?? 0) / 100} />,
              className: "text-right",
            },
            { header: "方式", cell: (row) => row.method },
            { header: "狀態", cell: (row) => <StatusBadge status={row.status === "CONFIRMED" ? "PAID" : row.status} /> },
          ]}
        />
      )}

      {tab === "balance" && balance && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-5">
            <h2 className="mb-1 text-sm font-semibold text-slate-700">目前餘額</h2>
            <p className="mb-4 text-xs text-slate-500">
              由金流事件帳本重新計算，可與放款帳戶欄位對帳。
            </p>
            <dl className="space-y-3">
              <BalanceRow label="剩餘本金" value={balance.outstandingPrincipal} />
              <BalanceRow label="剩餘利息" value={balance.outstandingInterest} />
              <BalanceRow label="剩餘費用" value={balance.outstandingFees} />
              <div className="border-t border-slate-200 pt-3">
                <BalanceRow label="總欠款" value={balance.totalOutstanding} strong />
              </div>
            </dl>
          </div>
          <div className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">累計已還</h2>
            <dl className="space-y-3">
              <BalanceRow label="已還本金" value={balance.principalPaid} />
              <BalanceRow label="已付利息" value={balance.interestPaid} />
              <BalanceRow label="已付費用" value={balance.feesPaid} />
              <div className="border-t border-slate-200 pt-3">
                <BalanceRow label="總還款" value={balance.totalPaid} strong />
              </div>
            </dl>
          </div>
        </div>
      )}

      {tab === "events" && (
        <DataTable
          rows={loan.moneyEvents}
          rowKey={(row) => row.id}
          empty="尚無金流事件"
          columns={[
            { header: "發生時間", cell: (row) => dateTime(row.occurredAt) },
            {
              header: "事件",
              cell: (row) => (
                <span className="font-medium">{EVENT_LABELS[row.type] ?? row.type}</span>
              ),
            },
            {
              header: "金額",
              cell: (row) => <Money value={row.amountCents / 100} />,
              className: "text-right",
            },
            {
              header: "說明",
              cell: (row) => <span className="font-mono text-xs text-slate-500">{row.metadata}</span>,
            },
          ]}
        />
      )}

      {tab === "chain" && (
        <div className="card p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">續借鏈</h2>
          {!chain || chain.chain.length <= 1 ? (
            <p className="text-sm text-slate-500">此放款沒有續借紀錄。</p>
          ) : (
            <ol className="space-y-3">
              {chain.chain.map((link) => (
                <li key={link.loanId} className="flex items-start gap-3">
                  <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
                    {link.sequence}
                  </span>
                  <div className="flex-1 rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between">
                      <Link
                        to={`/loans/${link.loanId}`}
                        className={`font-medium ${link.loanId === loan.id ? "text-slate-900" : "text-brand-600 hover:underline"}`}
                      >
                        {link.loanNumber}
                        {link.loanId === loan.id && <span className="ml-2 text-xs text-slate-400">（目前）</span>}
                      </Link>
                      <StatusBadge status={link.status} />
                    </div>
                    <div className="tabular mt-1 text-sm text-slate-600">{money(link.principal)}</div>
                    {link.renewedFrom && (
                      <div className="mt-1 text-xs text-slate-500">
                        續借自 {link.renewedFrom} ・ {link.reason}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {tab === "collection" && (
        <DataTable
          rows={loan.collectionCases}
          rowKey={(row) => row.id}
          empty="此放款沒有催收案件"
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
          ]}
        />
      )}

      {action && (
        <LoanActionDialog
          loanId={loan.id}
          kind={action}
          outstanding={totalOutstanding}
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null);
            queryClient.invalidateQueries({ queryKey: ["loan", id] });
            queryClient.invalidateQueries({ queryKey: ["loans"] });
          }}
        />
      )}
    </div>
  );
}

function BalanceRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className={`tabular text-sm ${strong ? "text-lg font-semibold" : "font-medium"}`}>
        {money(value)}
      </dd>
    </div>
  );
}

function LoanActionDialog({
  loanId,
  kind,
  outstanding,
  onClose,
  onDone,
}: {
  loanId: string;
  kind: "renew" | "extend";
  outstanding: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [additionalAmount, setAdditionalAmount] = useState("");
  const [termCount, setTermCount] = useState("3");
  const [extensionMonths, setExtensionMonths] = useState("1");
  const [fee, setFee] = useState("0");
  const [idempotencyKey] = useState(newIdempotencyKey);

  const mutation = useMutation({
    mutationFn: () =>
      kind === "renew"
        ? api(`/api/loans/${loanId}/renew`, {
            method: "POST",
            idempotencyKey,
            body: {
              reason,
              additionalAmount: additionalAmount || undefined,
              termCount: Number(termCount),
            },
          })
        : api(`/api/loans/${loanId}/extend`, {
            method: "POST",
            body: { reason, extensionMonths: Number(extensionMonths), fee: fee || 0 },
          }),
    onSuccess: onDone,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4">
      <div className="w-full max-w-lg rounded-t-2xl bg-white p-6 sm:rounded-2xl">
        <h2 className="text-lg font-semibold">{kind === "renew" ? "續借" : "展期"}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {kind === "renew"
            ? "續借會結清原放款並建立新放款，原放款歷史完整保留。"
            : "展期沿用同一筆放款，僅延長到期日與未繳期數。"}
        </p>

        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">目前總欠款</span>
            <span className="tabular font-semibold">{money(outstanding)}</span>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          {kind === "renew" ? (
            <>
              <div>
                <label className="label" htmlFor="loan-f1">增貸金額（可留空）</label>
                <input id="loan-f1"
                  className="input tabular"
                  inputMode="decimal"
                  value={additionalAmount}
                  onChange={(e) => setAdditionalAmount(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="label" htmlFor="loan-f2">新放款期數</label>
                <input id="loan-f2"
                  className="input tabular"
                  inputMode="numeric"
                  value={termCount}
                  onChange={(e) => setTermCount(e.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="label" htmlFor="loan-f3">展延月數</label>
                <input id="loan-f3"
                  className="input tabular"
                  inputMode="numeric"
                  value={extensionMonths}
                  onChange={(e) => setExtensionMonths(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="loan-f4">展期費</label>
                <input id="loan-f4"
                  className="input tabular"
                  inputMode="decimal"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                />
              </div>
            </>
          )}
          <div>
            <label className="label" htmlFor="loan-f5">原因 *</label>
            <textarea id="loan-f5"
              className="input"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </div>
        </div>

        <ErrorBanner error={mutation.error} />

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={mutation.isPending}>
            取消
          </button>
          <button
            className="btn-primary"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !reason.trim()}
          >
            {mutation.isPending ? "處理中…" : "確認"}
          </button>
        </div>
      </div>
    </div>
  );
}
