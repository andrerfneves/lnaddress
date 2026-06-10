import type { PropsWithChildren } from "react";

type TabsProps<T extends string> = PropsWithChildren<{
  value: T;
  options: { value: T; label: string }[];
  on_change: (value: T) => void;
}>;

export function Tabs<T extends string>({ value, options, on_change }: TabsProps<T>) {
  return (
    <div className="tabs" role="tablist" aria-label="Scenario">
      {options.map((option) => (
        <button
          aria-selected={option.value === value}
          className="tab"
          key={option.value}
          onClick={() => on_change(option.value)}
          role="tab"
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
