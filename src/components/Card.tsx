import type { HTMLAttributes } from 'react';
import clsx from '@/lib/clsx';

/**
 * 瀏覽畫面的列。
 *
 * 夜裡的東西不會有白底卡片、圓角與投影——那些都是白天的 UI 語彙。
 * 這裡的分隔只靠一條「被微光照到的線」與留白，hover 時整列稍微被照亮一點。
 */
export function Row({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        'border-b border-void-line py-5 transition-colors duration-200 hover:bg-ash-900/25',
        className,
      )}
      {...props}
    />
  );
}

/** 需要獨立框起來的資訊區塊（確認資訊、說明）。同樣沒有底色，只有邊。 */
export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('border border-void-line p-5', className)} {...props} />;
}
