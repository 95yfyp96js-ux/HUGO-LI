import type { ReactNode } from 'react';
import clsx from '@/lib/clsx';

/**
 * 紙。
 *
 * 這是全站唯一允許出現暖白色的地方，而且只有在那個東西「真的是紙」的時候：
 *   - 籤紙（抽到的籤詩）
 *   - 祈願卡（使用者寫下的願望、點燈的名條）
 *
 * 不是紙的東西一律不准用這個元件：列表、卡片、對話框、說明區塊都不是紙。
 * 這條規則的意義在於——當畫面上出現一張暖白色的東西時，
 * 使用者立刻知道「這是我寫的／我抽到的那張」，而不是又一個 UI 容器。
 *
 * 質感不靠貼圖或花紋，靠三件事：
 *   1. 紙比夜色亮很多，所以它自己就是畫面裡最亮的實體（但仍不是光源）
 *   2. 極輕微的紙緣陰影，讓它像放在桌上的一張紙，而不是一個發光的方塊
 *   3. 紙上的字是墨色的，不是白的——這是全站唯一的深色文字
 */
export function Paper({
  children,
  className,
  torn = false,
}: {
  children: ReactNode;
  className?: string;
  /** 籤紙用：上下裁切邊稍窄，像從籤筒抽出的長條紙籤 */
  torn?: boolean;
}) {
  return (
    <div
      className={clsx(
        'relative bg-paper text-paper-ink',
        torn ? 'px-7 py-10' : 'px-6 py-6',
        className,
      )}
      style={{
        boxShadow: '0 1px 0 rgba(0,0,0,0.35), 0 18px 40px -24px rgba(0,0,0,0.9)',
      }}
    >
      {children}
    </div>
  );
}

/** 紙上的分隔線。比 UI 的 border 更淡，像紙本身的折痕。 */
export function PaperRule({ className }: { className?: string }) {
  return <div className={clsx('h-px w-full bg-paper-shade', className)} aria-hidden />;
}
