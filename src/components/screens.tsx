import type { ReactNode } from 'react';
import clsx from '@/lib/clsx';
import { Light, type LightSpec } from './Light';

/**
 * 兩種畫面，兩種構圖邏輯。這個分野是結構性的，不是裝飾性的：
 *
 * CeremonyScreen（儀式）——置中對稱。宮廟建築是中軸線的：你站在中門，
 *   正對神像，左右對稱。儀式畫面複製這個身體經驗。
 *
 * PageScreen（瀏覽／管理）——靠左不對稱。看名冊、翻紀錄、填表格是
 *   「在側廂做事」，不是「在中軸線上敬拜」，所以刻意不給它對稱的莊嚴感。
 */

export function CeremonyScreen({
  light,
  children,
  className,
}: {
  /** 這個畫面唯一的光源 */
  light: LightSpec;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('relative flex min-h-screen flex-col overflow-hidden bg-void', className)}>
      <Light spec={light} />
      <div className="relative flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        {children}
      </div>
    </div>
  );
}

export function PageScreen({
  light,
  children,
  className,
}: {
  /** 這個畫面唯一的光源。省略時使用預設的左上角餘光（像側廂唯一的一盞燈） */
  light?: LightSpec;
  children: ReactNode;
  className?: string;
}) {
  const spec: LightSpec = light ?? { source: 'flame', x: 6, y: -6, radius: 46, intensity: 0.1 };
  return (
    <div className={clsx('relative min-h-full bg-void', className)}>
      <Light spec={spec} className="fixed" />
      {/* 靠左：內容有最大寬度以維持行長，但不置中——左邊界固定，右邊留空 */}
      <div className="relative max-w-2xl px-6 py-12 md:px-12 md:py-16">{children}</div>
    </div>
  );
}

/**
 * 儀式畫面的標題。字距拉開、字級小、置中——
 * 讓它讀起來像刻在匾額上的字，而不是 App 的 heading。
 */
export function RitualLabel({ children }: { children: ReactNode }) {
  return (
    <p className="font-display text-[11px] uppercase tracking-ritual text-ash-500">{children}</p>
  );
}

/** 瀏覽畫面的頁首。靠左、大留白、沒有任何裝飾線或圖示。 */
export function PageHeading({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-12">
      <h1 className="font-display text-2xl font-medium tracking-wide text-ash-100">{title}</h1>
      {description && <p className="mt-3 max-w-md text-sm leading-relaxed text-ash-500">{description}</p>}
    </header>
  );
}
