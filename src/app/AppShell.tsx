import { NavLink, Outlet, useLocation } from 'react-router-dom';
import clsx from '@/lib/clsx';
import { NAV_ITEMS } from './nav';

/**
 * Desktop（≥1024px）：Sidebar + Header。Mobile（<1024px）：Bottom Navigation。
 * 全螢幕儀式體驗頁面（拜拜/抽籤）在各自路由中以 fullscreen layout 覆蓋，不套用此 Shell。
 */
export function AppShell() {
  const location = useLocation();
  const isFullscreenCeremony = /^\/(worship|fortune)\//.test(location.pathname);

  if (isFullscreenCeremony) {
    return <Outlet />;
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="hidden w-60 shrink-0 border-r border-ink-100 bg-surface-raised lg:flex lg:flex-col">
        <div className="px-6 py-8">
          <p className="font-display text-lg font-medium text-ink-900">信仰時光</p>
          <p className="mt-1 text-xs text-ink-400">Digital Faith Platform · 原型</p>
        </div>
        <nav className="flex flex-col gap-1 px-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-ink-900 text-surface' : 'text-ink-600 hover:bg-ink-100',
                )
              }
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-ink-100 bg-surface-raised px-4 lg:hidden">
          <p className="font-display text-base font-medium text-ink-900">信仰時光</p>
        </header>

        <main className="flex-1 pb-20 lg:pb-0">
          <Outlet />
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-ink-100 bg-surface-raised lg:hidden">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors',
                  isActive ? 'text-ink-900' : 'text-ink-400',
                )
              }
            >
              <span aria-hidden className="text-lg leading-none">
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
