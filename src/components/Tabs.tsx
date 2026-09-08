import clsx from '@/lib/clsx';

interface TabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}

/**
 * 分頁。沒有膠囊底色、沒有滑塊——
 * 選取狀態只用「被照到的字色」與一條下方細線表示。
 */
export function Tabs<T extends string>({ value, onChange, options }: TabsProps<T>) {
  return (
    <div role="tablist" className="flex flex-wrap gap-x-7 gap-y-2 border-b border-void-line">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={clsx(
              '-mb-px border-b pb-3 text-[13px] tracking-wide transition-colors duration-200',
              selected
                ? 'border-flame/70 text-ash-100'
                : 'border-transparent text-ash-700 hover:text-ash-300',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
