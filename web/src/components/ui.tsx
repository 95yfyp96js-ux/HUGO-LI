import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  APPLICATION_STATUS_LABELS,
  COLLECTION_STATUS_LABELS,
  LOAN_STATUS_LABELS,
  PRIORITY_LABELS,
  money,
} from "../lib/format";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const STATUS_TONES: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  APPROVED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  PAID_OFF: "bg-slate-100 text-slate-600 ring-slate-200",
  PAID: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  CLOSED: "bg-slate-100 text-slate-600 ring-slate-200",
  OVERDUE: "bg-rose-50 text-rose-700 ring-rose-200",
  DEFAULTED: "bg-rose-100 text-rose-800 ring-rose-300",
  ESCALATED: "bg-rose-50 text-rose-700 ring-rose-200",
  DUE: "bg-amber-50 text-amber-700 ring-amber-200",
  DUE_SOON: "bg-amber-50 text-amber-700 ring-amber-200",
  READY_FOR_DISBURSEMENT: "bg-brand-50 text-brand-700 ring-brand-100",
  DISBURSED: "bg-brand-50 text-brand-700 ring-brand-100",
  UNDER_REVIEW: "bg-brand-50 text-brand-700 ring-brand-100",
  RISK_REVIEW: "bg-amber-50 text-amber-700 ring-amber-200",
  SUBMITTED: "bg-brand-50 text-brand-700 ring-brand-100",
  IN_PROGRESS: "bg-brand-50 text-brand-700 ring-brand-100",
  PROMISE_TO_PAY: "bg-violet-50 text-violet-700 ring-violet-200",
  REJECTED: "bg-rose-50 text-rose-700 ring-rose-200",
  CANCELLED: "bg-slate-100 text-slate-500 ring-slate-200",
  RESTRUCTURED: "bg-violet-50 text-violet-700 ring-violet-200",
  DRAFT: "bg-slate-100 text-slate-600 ring-slate-200",
  OPEN: "bg-amber-50 text-amber-700 ring-amber-200",
  CRITICAL: "bg-rose-100 text-rose-800 ring-rose-300",
  HIGH: "bg-rose-50 text-rose-700 ring-rose-200",
  MEDIUM: "bg-amber-50 text-amber-700 ring-amber-200",
  LOW: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function StatusBadge({ status, kind }: { status: string; kind?: "loan" | "application" | "collection" | "priority" }) {
  const labels =
    kind === "application"
      ? APPLICATION_STATUS_LABELS
      : kind === "collection"
        ? COLLECTION_STATUS_LABELS
        : kind === "priority"
          ? PRIORITY_LABELS
          : LOAN_STATUS_LABELS;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
        STATUS_TONES[status] ?? "bg-slate-100 text-slate-600 ring-slate-200"
      }`}
    >
      {labels[status] ?? status}
    </span>
  );
}

export function RiskGradeBadge({ grade }: { grade: string | null | undefined }) {
  if (!grade) return <span className="text-slate-400">—</span>;
  const tone: Record<string, string> = {
    A: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    B: "bg-teal-50 text-teal-700 ring-teal-200",
    C: "bg-amber-50 text-amber-700 ring-amber-200",
    D: "bg-orange-50 text-orange-700 ring-orange-200",
    E: "bg-rose-50 text-rose-700 ring-rose-200",
  };
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ring-1 ring-inset ${
        tone[grade] ?? "bg-slate-100 text-slate-600 ring-slate-200"
      }`}
    >
      {grade}
    </span>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  to,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  to?: string;
  tone?: "default" | "danger" | "success" | "warning";
}) {
  const tones = {
    default: "text-slate-900",
    danger: "text-rose-600",
    success: "text-emerald-600",
    warning: "text-amber-600",
  };

  const content = (
    <div className="card h-full p-4 transition hover:border-brand-200">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`tabular mt-2 text-2xl font-semibold ${tones[tone]}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );

  // Every KPI drills down to the records behind it (§33).
  return to ? (
    <Link to={to} className="block">
      {content}
    </Link>
  ) : (
    content
  );
}

export function DataTable<T>({
  columns,
  rows,
  empty = "沒有資料",
  rowKey,
}: {
  columns: Array<{ header: string; cell: (row: T) => ReactNode; className?: string }>;
  rows: T[];
  empty?: string;
  rowKey: (row: T) => string;
}) {
  if (rows.length === 0) {
    return <div className="card p-8 text-center text-sm text-slate-500">{empty}</div>;
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((column) => (
                <th key={column.header} className={`th ${column.className ?? ""}`}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-slate-50">
                {columns.map((column) => (
                  <td key={column.header} className={`td ${column.className ?? ""}`}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Money({ value, className = "" }: { value: string | number | null | undefined; className?: string }) {
  return <span className={`tabular ${className}`}>{money(value)}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-900">{children}</dd>
    </div>
  );
}

export function Loading({ label = "載入中..." }: { label?: string }) {
  return <div className="p-8 text-center text-sm text-slate-500">{label}</div>;
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "發生未預期的錯誤";
  const code = (error as { code?: string })?.code;
  return (
    <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <div className="font-medium">{message}</div>
      {code && <div className="mt-1 font-mono text-xs text-rose-600">{code}</div>}
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: string; label: string }>;
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="mb-4 overflow-x-auto border-b border-slate-200">
      <nav className="flex gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              active === tab.id
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
