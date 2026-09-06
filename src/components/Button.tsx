import { type ButtonHTMLAttributes, forwardRef } from 'react';
import clsx from '@/lib/clsx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-ink-900 text-surface hover:bg-ink-800 disabled:bg-ink-300',
  secondary:
    'bg-transparent text-ink-900 border border-ink-300 hover:border-ink-500 disabled:text-ink-300 disabled:border-ink-200',
  ghost: 'bg-transparent text-ink-700 hover:bg-ink-100 disabled:text-ink-300',
  danger: 'bg-ember-600 text-surface hover:bg-ember-700 disabled:bg-ember-200',
};

const sizeClasses: Record<Size, string> = {
  md: 'h-11 px-5 text-sm',
  lg: 'h-13 px-6 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className, ...props }, ref) => (
    <button
      ref={ref}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-150',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-500',
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
