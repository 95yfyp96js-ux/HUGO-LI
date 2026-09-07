import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { date, dateTime, money } from "../lib/format";
import { ErrorBanner, Field, Loading, PageHeader, StatusBadge } from "../components/ui";
import { useAuth } from "../lib/auth";

interface CollectionDetail {
  id: string;
  caseNumber: string;
  status: string;
  priority: string;
  daysOverdue: number;
  outstandingAmountCents: number;
  nextActionAt: string | null;
  createdAt: string;
  loan: { id: string; loanNumber: string; status: string; maturityDate: string | null };
  customer: { id: string; name: string; customerNumber: string; phone: string };
  assignedUser: { id: string; displayName: string } | null;
  activities: Array<{
    id: string;
    type: string;
    result: string | null;
    note: string | null;
    createdBy: string;
    createdAt: string;
    nextActionAt: string | null;
  }>;
  promises: Array<{
    id: string;
    promisedAmountCents: number;
    promisedDate: string;
    status: string;
    createdAt: string;
  }>;
}

const ACTIVITY_LABELS: Record<string, string> = {
  PHONE: "電話",
  SMS: "簡訊",
  EMAIL: "電子郵件",
  IN_PERSON: "當面拜訪",
  SYSTEM: "系統",
  OTHER: "其他",
};

export function CollectionDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const [activity, setActivity] = useState({ type: "PHONE", result: "", note: "", nextActionAt: "" });
  const [promise, setPromise] = useState({ amount: "", promisedDate: "" });

  const { data, isLoading, error } = useQuery({
    queryKey: ["collection", id],
    queryFn: () => api<CollectionDetail>(`/api/collections/${id}`),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["collection", id] });

  const activityMutation = useMutation({
    mutationFn: () =>
      api(`/api/collections/${id}/activity`, {
        method: "POST",
        body: {
          type: activity.type,
          result: activity.result || null,
          note: activity.note || null,
          nextActionAt: activity.nextActionAt || undefined,
        },
      }),
    onSuccess: () => {
      setActivity({ type: "PHONE", result: "", note: "", nextActionAt: "" });
      invalidate();
    },
  });

  const promiseMutation = useMutation({
    mutationFn: () =>
      api(`/api/collections/${id}/promise`, {
        method: "POST",
        body: { amount: promise.amount, promisedDate: promise.promisedDate },
      }),
    onSuccess: () => {
      setPromise({ amount: "", promisedDate: "" });
      invalidate();
    },
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;
  if (!data) return null;

  return (
    <div>
      <PageHeader
        title={data.caseNumber}
        subtitle={`${data.customer.name}（${data.customer.customerNumber}）・ ${data.customer.phone}`}
        actions={
          <>
            <Link to={`/payments/new?loanId=${data.loan.id}`} className="btn-primary">
              收款
            </Link>
            <Link to={`/loans/${data.loan.id}`} className="btn-secondary">
              放款明細
            </Link>
          </>
        }
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-1">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">案件資訊</h2>
          <dl className="grid grid-cols-2 gap-4">
            <Field label="狀態">
              <StatusBadge status={data.status} kind="collection" />
            </Field>
            <Field label="優先度">
              <StatusBadge status={data.priority} kind="priority" />
            </Field>
            <Field label="逾期天數">
              <span className="text-rose-600">{data.daysOverdue} 天</span>
            </Field>
            <Field label="欠款">{money(data.outstandingAmountCents / 100)}</Field>
            <Field label="放款編號">
              <Link to={`/loans/${data.loan.id}`} className="text-brand-600 hover:underline">
                {data.loan.loanNumber}
              </Link>
            </Field>
            <Field label="到期日">{date(data.loan.maturityDate)}</Field>
            <Field label="負責人">{data.assignedUser?.displayName ?? "未指派"}</Field>
            <Field label="下次追蹤">{date(data.nextActionAt)}</Field>
          </dl>
        </div>

        <div className="space-y-4 lg:col-span-2">
          {can("COLLECTION_UPDATE") && (
            <div className="card p-5">
              <h2 className="mb-4 text-sm font-semibold text-slate-700">新增催收紀錄</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="coll-f1">聯繫方式</label>
                  <select id="coll-f1"
                    className="input"
                    value={activity.type}
                    onChange={(e) => setActivity((a) => ({ ...a, type: e.target.value }))}
                  >
                    {Object.entries(ACTIVITY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="coll-f2">結果</label>
                  <input id="coll-f2"
                    className="input"
                    value={activity.result}
                    onChange={(e) => setActivity((a) => ({ ...a, result: e.target.value }))}
                    placeholder="例：客戶承諾 9/10 還款"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="coll-f3">備註</label>
                  <textarea id="coll-f3"
                    className="input"
                    rows={2}
                    value={activity.note}
                    onChange={(e) => setActivity((a) => ({ ...a, note: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="coll-f4">下次追蹤日</label>
                  <input id="coll-f4"
                    type="date"
                    className="input"
                    value={activity.nextActionAt}
                    onChange={(e) => setActivity((a) => ({ ...a, nextActionAt: e.target.value }))}
                  />
                </div>
              </div>
              <ErrorBanner error={activityMutation.error} />
              <div className="mt-4 flex justify-end">
                <button
                  className="btn-primary"
                  onClick={() => activityMutation.mutate()}
                  disabled={activityMutation.isPending}
                >
                  {activityMutation.isPending ? "儲存中…" : "新增紀錄"}
                </button>
              </div>
            </div>
          )}

          {can("COLLECTION_UPDATE") && (
            <div className="card p-5">
              <h2 className="mb-4 text-sm font-semibold text-slate-700">建立還款承諾</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="coll-f5">承諾金額</label>
                  <input id="coll-f5"
                    className="input tabular"
                    inputMode="decimal"
                    value={promise.amount}
                    onChange={(e) => setPromise((p) => ({ ...p, amount: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="coll-f6">承諾日期</label>
                  <input id="coll-f6"
                    type="date"
                    className="input"
                    value={promise.promisedDate}
                    onChange={(e) => setPromise((p) => ({ ...p, promisedDate: e.target.value }))}
                  />
                </div>
              </div>
              <ErrorBanner error={promiseMutation.error} />
              <div className="mt-4 flex justify-end">
                <button
                  className="btn-secondary"
                  onClick={() => promiseMutation.mutate()}
                  disabled={promiseMutation.isPending || !promise.amount || !promise.promisedDate}
                >
                  建立承諾
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">催收紀錄</h2>
          {data.activities.length === 0 ? (
            <p className="text-sm text-slate-500">尚無催收紀錄</p>
          ) : (
            <ol className="space-y-3">
              {data.activities.map((item) => (
                <li key={item.id} className="border-l-2 border-brand-200 pl-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{ACTIVITY_LABELS[item.type] ?? item.type}</span>
                    <span className="text-xs text-slate-400">{dateTime(item.createdAt)}</span>
                  </div>
                  {item.result && <div className="mt-0.5 text-sm text-slate-700">{item.result}</div>}
                  {item.note && <div className="mt-0.5 text-xs text-slate-500">{item.note}</div>}
                  {item.nextActionAt && (
                    <div className="mt-1 text-xs text-brand-600">下次追蹤：{date(item.nextActionAt)}</div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="card p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">還款承諾</h2>
          {data.promises.length === 0 ? (
            <p className="text-sm text-slate-500">尚無還款承諾</p>
          ) : (
            <ul className="space-y-2">
              {data.promises.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 p-3"
                >
                  <div>
                    <div className="tabular text-sm font-medium">{money(p.promisedAmountCents / 100)}</div>
                    <div className="text-xs text-slate-500">承諾日期 {date(p.promisedDate)}</div>
                  </div>
                  <StatusBadge status={p.status === "PENDING" ? "PROMISE_TO_PAY" : p.status} kind="collection" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
