import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { IS_SNAPSHOT } from "../lib/snapshot";
import { api } from "../lib/api";
import { ErrorBanner } from "./ui";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  permission?: string;
}

const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "營運",
    items: [
      { to: "/dashboard", label: "營運總覽", icon: "▤", permission: "LOAN_READ" },
      { to: "/quick-actions", label: "快速作業", icon: "⚡" },
    ],
  },
  {
    title: "放款",
    items: [
      { to: "/customers", label: "客戶", icon: "👤", permission: "CUSTOMER_READ" },
      { to: "/lending/applications", label: "放款申請", icon: "📄", permission: "APPLICATION_READ" },
      { to: "/loans/new-slip", label: "放款單", icon: "📝", permission: "LOAN_DISBURSE" },
      { to: "/loans", label: "放款帳戶", icon: "💰", permission: "LOAN_READ" },
      { to: "/loans/pending-disbursement", label: "待撥款", icon: "🏦", permission: "LOAN_READ" },
      { to: "/loans/overdue", label: "逾期管理", icon: "⚠️", permission: "LOAN_READ" },
    ],
  },
  {
    title: "帳務",
    items: [
      { to: "/payments/due-today", label: "今日應收", icon: "📅", permission: "PAYMENT_READ" },
      { to: "/payments", label: "收款紀錄", icon: "🧾", permission: "PAYMENT_READ" },
      { to: "/collections/schedule", label: "催款日程表", icon: "🗓", permission: "PAYMENT_READ" },
      { to: "/calendar", label: "月曆", icon: "📆", permission: "PAYMENT_READ" },
      { to: "/collections", label: "催收", icon: "📞", permission: "COLLECTION_READ" },
      { to: "/renewals", label: "續借紀錄", icon: "🔁", permission: "LOAN_READ" },
      { to: "/reports", label: "報表", icon: "📊", permission: "LOAN_READ" },
    ],
  },
  {
    title: "設定",
    items: [
      { to: "/products", label: "放款產品", icon: "📦", permission: "PRODUCT_READ" },
      { to: "/settings/users", label: "使用者", icon: "🔑", permission: "USER_MANAGE" },
      { to: "/settings/roles", label: "角色權限", icon: "🛡", permission: "USER_MANAGE" },
      { to: "/settings/audit-logs", label: "操作紀錄", icon: "📋", permission: "AUDIT_READ" },
    ],
  },
];

// The four operations that matter on a phone (§44).
const MOBILE_NAV: NavItem[] = [
  { to: "/dashboard", label: "總覽", icon: "▤" },
  { to: "/loans", label: "放款", icon: "💰" },
  { to: "/quick-actions", label: "快速", icon: "⚡" },
  { to: "/collections", label: "催收", icon: "📞" },
];

export function Layout() {
  const { user, logout, can } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const location = useLocation();

  const visible = (item: NavItem) => !item.permission || can(item.permission);

  // pt-6 clears the fixed training banner, which owns the top 1.5rem of the
  // viewport on every route.
  return (
    <div className="min-h-screen pt-6 lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
        <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-5">
          <span className="text-lg font-bold text-brand-700">Small Lending OS</span>
        </div>
        <nav className="space-y-6 p-4">
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter(visible);
            if (items.length === 0) return null;
            return (
              <div key={section.title}>
                <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {section.title}
                </div>
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === "/loans"}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                          isActive
                            ? "bg-brand-50 text-brand-700"
                            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                        }`
                      }
                    >
                      <span className="w-5 text-center">{item.icon}</span>
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-6 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-8">
          <button
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="開啟選單"
          >
            ☰
          </button>
          <span className="font-semibold text-brand-700 lg:hidden">Small Lending OS</span>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium text-slate-900">{user?.displayName}</div>
              <div className="text-xs text-slate-500">{user?.roles.join(", ")}</div>
            </div>
            {!IS_SNAPSHOT && (
              <button onClick={() => setChangingPassword(true)} className="btn-secondary text-xs">
                變更密碼
              </button>
            )}
            {!IS_SNAPSHOT && (
              <button onClick={logout} className="btn-secondary text-xs">
                登出
              </button>
            )}
          </div>
        </header>

        {changingPassword && (
          <ChangePasswordModal onClose={() => setChangingPassword(false)} />
        )}

        {/* Mobile drawer */}
        {menuOpen && (
          <div className="border-b border-slate-200 bg-white p-4 lg:hidden">
            {NAV_SECTIONS.flatMap((section) => section.items)
              .filter(visible)
              .map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    `touch-target flex items-center gap-3 rounded-lg px-3 text-sm font-medium ${
                      isActive ? "bg-brand-50 text-brand-700" : "text-slate-700"
                    }`
                  }
                >
                  <span className="w-5 text-center">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
          </div>
        )}

        {IS_SNAPSHOT && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 lg:px-8">
            <span className="font-semibold">唯讀展示版本。</span>
            畫面上的金額、利率、期程與 KPI 都是後端引擎實際計算後匯出的快照，
            但新增、審核、撥款、收款等寫入操作在此版本無法執行。完整可操作系統請在本機執行
            <code className="mx-1 rounded bg-amber-100 px-1 py-0.5">npm run dev:server</code>與
            <code className="mx-1 rounded bg-amber-100 px-1 py-0.5">npm run dev:web</code>。
          </div>
        )}

        <main className="flex-1 p-4 pb-24 lg:p-8 lg:pb-8">
          <Outlet key={location.pathname} />
        </main>

        {/* Mobile bottom navigation */}
        <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
          {MOBILE_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/loans"}
              className={({ isActive }) =>
                `touch-target flex flex-col items-center justify-center gap-1 text-xs font-medium ${
                  isActive ? "text-brand-700" : "text-slate-500"
                }`
              }
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

/** Self-service only — there is no "set someone else's password" path, even for USER_MANAGE. */
function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      api("/api/auth/change-password", { method: "POST", body: { currentPassword, newPassword } }),
    onSuccess: () => setDone(true),
  });

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const tooShort = newPassword.length > 0 && newPassword.length < 10;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6">
        <h2 className="text-lg font-semibold">變更密碼</h2>

        {done ? (
          <>
            <p className="mt-3 text-sm text-emerald-700">密碼已更新。</p>
            <div className="mt-4 flex justify-end">
              <button className="btn-primary" onClick={onClose}>
                關閉
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-4 space-y-3">
              <div>
                <label className="label" htmlFor="pwd-current">目前密碼</label>
                <input
                  id="pwd-current"
                  type="password"
                  className="input"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div>
                <label className="label" htmlFor="pwd-new">新密碼（至少 10 碼）</label>
                <input
                  id="pwd-new"
                  type="password"
                  className="input"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
                {tooShort && <p className="mt-1 text-xs text-rose-600">新密碼至少需要 10 碼</p>}
              </div>
              <div>
                <label className="label" htmlFor="pwd-confirm">確認新密碼</label>
                <input
                  id="pwd-confirm"
                  type="password"
                  className="input"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
                {mismatch && <p className="mt-1 text-xs text-rose-600">兩次輸入的新密碼不一致</p>}
              </div>
            </div>

            <ErrorBanner error={mutation.error} />

            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary" onClick={onClose}>
                取消
              </button>
              <button
                className="btn-primary"
                disabled={
                  mutation.isPending ||
                  !currentPassword ||
                  newPassword.length < 10 ||
                  newPassword !== confirmPassword
                }
                onClick={() => mutation.mutate()}
              >
                {mutation.isPending ? "更新中…" : "更新密碼"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
