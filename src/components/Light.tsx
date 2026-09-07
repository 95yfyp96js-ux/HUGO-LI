import clsx from '@/lib/clsx';

export type LightSource = 'ember' | 'flame';

export interface LightSpec {
  /** 光源的種類：香爐的火（ember）或燭／燈火（flame） */
  source: LightSource;
  /** 光源位置，相對於畫面的百分比 */
  x: number;
  y: number;
  /** 光暈半徑（vmax %），決定這盞光照亮多大範圍 */
  radius: number;
  /** 0–1。夜裡的光不該把畫面照亮，只該讓周圍勉強可見 */
  intensity: number;
}

const RGB: Record<LightSource, string> = {
  ember: 'var(--light-ember)',
  flame: 'var(--light-flame)',
};

/**
 * 畫面唯一的光源。
 *
 * 這個元件刻意不 export 給頁面直接使用——頁面只能透過 CeremonyScreen／PageScreen
 * 各自的單一 `light` prop 取得一盞光，讓「一個畫面只有一個光源」由架構保證，
 * 而不是靠開發者自律。
 */
export function Light({ spec, className }: { spec: LightSpec; className?: string }) {
  const rgb = RGB[spec.source];
  return (
    <div
      aria-hidden
      className={clsx('pointer-events-none absolute inset-0 overflow-hidden', className)}
      style={{
        background: [
          // 核心光暈。衰減刻意做得比一般 UI 的柔和漸層更快——
          // 真實的火光是「近處很亮、一步之外就暗下去」，慢衰減會讓畫面變成一片棕霧。
          `radial-gradient(${spec.radius}vmax ${spec.radius}vmax at ${spec.x}% ${spec.y}%, rgba(${rgb}, ${spec.intensity}) 0%, rgba(${rgb}, ${spec.intensity * 0.5}) 10%, rgba(${rgb}, ${spec.intensity * 0.16}) 26%, rgba(${rgb}, 0) 58%)`,
          // 更遠的餘光，讓黑不是死黑，而是「光照不到的地方」
          `radial-gradient(${spec.radius * 2.2}vmax ${spec.radius * 2.2}vmax at ${spec.x}% ${spec.y}%, rgba(${rgb}, ${spec.intensity * 0.09}) 0%, rgba(${rgb}, 0) 62%)`,
        ].join(', '),
      }}
    />
  );
}
