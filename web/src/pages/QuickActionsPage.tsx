import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { money } from "../lib/format";
import { Loading, StatusBadge } from "../components/ui";
import { useAuth } from "../lib/auth";

interface SearchLoan {
  id: string;
  loanNumber: string;
  status: string;
  totalOutstanding: string;
  daysOverdue: number;
  customer: { id: string; name: string; customerNumber: string };
}

interface Summary {
  todayDisbursement: string;
  todayCollection: string;
  dueTodayCount: number;
  overdueLoanCount: number;
}

/**
 * Mobile-first operations screen (§44). Large tap targets, a single search
 * box that matches loans or customers, and the two workflows that matter in
 * the field: take a payment, start a loan.
 */
export function QuickActionsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const { data: summary } = useQuery({
    queryKey: ["portfolio-summary"],
    queryFn: () => api<Summary>("/api/portfolio/summary"),
  });

  const { data: loans, isFetching } = useQuery({
    queryKey: ["quick-search", query],
    queryFn: () => api<{ items: SearchLoan[] }>("/api/loans", { query: { take: 100 } }),
    enabled: query.length > 0,
    select: (result) => ({
      items: result.items
        .filter(
          (loan) =>
            loan.loanNumber.toLowerCase().includes(query.toLowerCase()) ||
            loan.customer.name.includes(query) ||
            loan.customer.customerNumber.toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, 10),
    }),
  });

  const actions = [
    { to: "/payments/new", label: "快速收款", icon: "💵", tone: "bg-emerald-500", permission: "PAYMENT_CREATE" },
    { to: "/loans/new-slip", label: "貸款登記", icon: "➕", tone: "bg-brand-600", permission: "LOAN_DISBURSE" },
    { to: "/customers/new", label: "新增客戶", icon: "👤", tone: "bg-violet-500", permission: "CUSTOMER_CREATE" },
    { to: "/loans/overdue", label: "逾期催收", icon: "⚠️", tone: "bg-rose-500", permission: "LOAN_READ" },
  ].filter((action) => can(action.permission));

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold">快速作業</h1>

      {summary && (
        <div className="mb-5 grid grid-cols-2 gap-3">
          <div className="card p-4">
            <div className="text-xs text-slate-500">今日放款</div>
            <div className="tabular mt-1 text-lg font-semibold">{money(summary.todayDisbursement)}</div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-slate-500">今日收款</div>
            <div className="tabular mt-1 text-lg font-semibold text-emerald-600">
              {money(summary.todayCollection)}
            </div>
          </div>
          <Link to="/loans?status=DUE" className="card p-4">
            <div className="text-xs text-slate-500">今日到期</div>
            <div className="tabular mt-1 text-lg font-semibold text-amber-600">
              {summary.dueTodayCount} 件
            </div>
          </Link>
          <Link to="/loans/overdue" className="card p-4">
            <div className="text-xs text-slate-500">逾期件數</div>
            <div className="tabular mt-1 text-lg font-semibold text-rose-600">
              {summary.overdueLoanCount} 件
            </div>
          </Link>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3">
        {actions.map((action) => (
          <Link
            key={action.to}
            to={action.to}
            className={`touch-target flex flex-col items-center justify-center gap-1 rounded-xl ${action.tone} p-4 text-white shadow-sm active:scale-95`}
          >
            <span className="text-2xl">{action.icon}</span>
            <span className="text-sm font-medium">{action.label}</span>
          </Link>
        ))}
      </div>

      <div className="card p-4">
        <label className="label" htmlFor="quic-f1">快速查詢</label>
        <input id="quic-f1"
          className="input text-base"
          placeholder="輸入放款編號或客戶姓名"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {isFetching && <Loading label="搜尋中…" />}

        {loans && loans.items.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100">
            {loans.items.map((loan) => (
              <li key={loan.id}>
                <button
                  className="touch-target flex w-full items-center justify-between gap-3 text-left"
                  onClick={() => navigate(`/loans/${loan.id}`)}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{loan.customer.name}</div>
                    <div className="tabular text-xs text-slate-500">{loan.loanNumber}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tabular text-sm font-semibold">{money(loan.totalOutstanding)}</div>
                    <StatusBadge status={loan.status} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {query.length > 0 && loans?.items.length === 0 && !isFetching && (
          <p className="mt-3 text-sm text-slate-500">查無符合的放款</p>
        )}
      </div>
    </div>
  );
}
