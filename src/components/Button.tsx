import { type ButtonHTMLAttributes, forwardRef } from 'react';
import clsx from '@/lib/clsx';

type Variant = 'ritual' | 'quiet' | 'text';
type Size = 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/**
 * 夜裡的按鈕不能是一塊有外框的方塊——在只有一盞光的畫面裡，
 * 一個描邊的矩形會立刻變成第二個發亮的東西，把注意力從香火／籤紙上拉走。
 *
 * 所以這裡沒有任何「按鈕的形狀」：只有拉開字距的字，加上一條細線。
 * 可點擊的訊號來自字距、字色與底線，而不是來自容器。
 *
 * ritual：儀式中的主要動作。火光色的字 + 一條同色細線，hover 時被照得更亮。
 * quiet ：管理／表單的主要動作。同樣結構，但用灰燼色。
 * text  ：連線都沒有的次要動作。
 */
const variantClasses: Record<Variant, string> = {
  ritual:
    'border-b border-flame/45 text-flame-core hover:border-flame hover:text-flame-core disabled:border-ash-900 disabled:text-ash-700',
  quiet:
    'border-b border-ash-900 text-ash-300 hover:border-ash-700 hover:text-ash-100 disabled:border-ash-900 disabled:text-ash-700',
  text: 'border-b border-transparent text-ash-500 hover:text-ash-100 disabled:text-ash-700',
};

const sizeClasses: Record<Size, string> = {
  md: 'pb-2 text-[13px] tracking-[0.2em]',
  lg: 'pb-2.5 text-sm tracking-[0.28em]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'ritual', size = 'md', className, ...props }, ref) => (
    <button
      ref={ref}
      className={clsx(
        // indent 補回字距造成的視覺偏移，讓字在線的正中央
        'inline-flex items-center justify-center bg-transparent indent-[0.2em] font-body transition-all duration-300',
        'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-8 focus-visible:outline-flame/50',
        'disabled:cursor-not-allowed',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
