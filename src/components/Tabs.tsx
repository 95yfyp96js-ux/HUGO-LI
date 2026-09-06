import clsx from '@/lib/clsx';

interface TabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}

export function Tabs<T extends string>({ value, onChange, options }: TabsProps<T>) {
  return (
    <div role="tablist" className="inline-flex rounded-md bg-ink-100 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          type="button"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={clsx(
            'rounded-sm px-4 py-1.5 text-sm font-medium transition-colors duration-150',
            value === option.value
              ? 'bg-surface-raised text-ink-900 shadow-soft'
              : 'text-ink-500 hover:text-ink-700',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
