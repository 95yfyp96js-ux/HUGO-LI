/**
 * Presentation-only formatting. Note there is NO arithmetic here: every
 * monetary figure arrives from the API already computed by the domain
 * engines (spec §3 — the UI must not implement financial logic).
 */
const currencyFormatter = new Intl.NumberFormat("zh-TW", {
  style: "currency",
  currency: "TWD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const preciseFormatter = new Intl.NumberFormat("zh-TW", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return currencyFormatter.format(Number(value));
}

export function moneyPrecise(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return preciseFormatter.format(Number(value));
}

export function date(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function percent(value: number | null | undefined, unit?: string): string {
  if (value === null || value === undefined) return "—";
  const suffix = unit === "MONTHLY" ? "／月" : unit === "DAILY" ? "／日" : unit === "ANNUAL" ? "／年" : "";
  return `${value}%${suffix}`;
}

export const LOAN_STATUS_LABELS: Record<string, string> = {
  CREATED: "已建立",
  APPROVED: "已核准",
  READY_FOR_DISBURSEMENT: "待撥款",
  DISBURSED: "已撥款",
  ACTIVE: "放款中",
  DUE_SOON: "即將到期",
  DUE: "今日到期",
  OVERDUE: "逾期",
  RESTRUCTURED: "已重整",
  DEFAULTED: "呆帳",
  PAID_OFF: "已結清",
  CANCELLED: "已取消",
};

export const APPLICATION_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已送件",
  UNDER_REVIEW: "審核中",
  RISK_REVIEW: "風控複審",
  APPROVED: "已核准",
  REJECTED: "已婉拒",
  CANCELLED: "已取消",
  EXPIRED: "已逾期失效",
};

export const COLLECTION_STATUS_LABELS: Record<string, string> = {
  OPEN: "待處理",
  IN_PROGRESS: "催收中",
  PROMISE_TO_PAY: "已承諾還款",
  ESCALATED: "已升級",
  PAID: "已還款",
  CLOSED: "已結案",
};

export const PRIORITY_LABELS: Record<string, string> = {
  LOW: "低",
  MEDIUM: "中",
  HIGH: "高",
  CRITICAL: "緊急",
};

export const REPAYMENT_METHOD_LABELS: Record<string, string> = {
  INTEREST_ONLY: "按月付息、到期還本",
  PRINCIPAL_AND_INTEREST: "本息分期攤還",
  PRINCIPAL_ONLY: "僅還本金",
  BULLET: "到期一次清償",
  CUSTOM: "自訂",
};

export const RATE_UNIT_LABEL: Record<string, string> = { DAILY: "日", MONTHLY: "月", ANNUAL: "年" };

/** A day-term product is measured in 天; a month-term one in 期. */
export function termSuffix(termUnit: string | null | undefined): string {
  return termUnit === "DAY" ? "天" : "期";
}

/** The noun for a term field: 天數 for day products, 期數 for month products. */
export function termNoun(termUnit: string | null | undefined): string {
  return termUnit === "DAY" ? "天數" : "期數";
}

/** Renders a term range with its own unit, e.g. "7 ~ 30 天". */
export function termRange(min: number, max: number, termUnit: string | null | undefined): string {
  return `${min} ~ ${max} ${termSuffix(termUnit)}`;
}
