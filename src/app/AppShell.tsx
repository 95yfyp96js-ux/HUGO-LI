import { NavLink, Outlet, useLocation } from 'react-router-dom';
import clsx from '@/lib/clsx';
import { NAV_ITEMS } from './nav';

/**
 * 全螢幕儀式路由（拜拜／抽籤／點燈）不套用這層外框——
 * 儀式進行時畫面上不該有導覽列，那會破壞「只有一個光源」與置中對稱的構圖。
 */
const CEREMONY_ROUTE = /^\/(worship|fortune)\/|^\/lantern\/new/;

export function AppShell() {
  const location = useLocation();

  if (CEREMONY_ROUTE.test(location.pathname)) {
    return <Outlet />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-void lg:flex-row">
      {/* 桌面：左側導覽。它本身就是「靠左不對稱」構圖的一部分 */}
      <aside className="hidden w-56 shrink-0 border-r border-void-line lg:block">
        <div className="sticky top-0 px-8 py-12">
          <p className="font-display text-sm tracking-ritual text-ash-300">信仰時光</p>
          <nav className="mt-14 flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  clsx(
                    'border-l py-2.5 pl-4 text-[13px] tracking-wide transition-colors duration-200',
                    isActive
                      ? 'border-flame/70 text-ash-100'
                      : 'border-transparent text-ash-700 hover:text-ash-300',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center border-b border-void-line px-6 lg:hidden">
          <p className="font-display text-xs tracking-ritual text-ash-500">信仰時光</p>
        </header>

        <main className="flex-1 pb-20 lg:pb-0">
          <Outlet />
        </main>

        {/* 手機：底部導覽。同樣只有文字，選取狀態是一條被火光照到的線 */}
        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-void-line bg-void/95 backdrop-blur-sm lg:hidden">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex flex-1 justify-center border-t py-4 text-[11px] tracking-wide transition-colors duration-200',
                  isActive ? 'border-flame/70 text-ash-100' : 'border-transparent text-ash-700',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
