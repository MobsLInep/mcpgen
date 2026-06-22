"use client";

import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export interface SegmentedProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}

/** A pill segmented control used for kind / transport / auth selection. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  ...aria
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={aria["aria-label"]}
      className={cn(
        "inline-flex rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]/60 p-1",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-[var(--color-signal)] text-[var(--color-signal-ink)] shadow-sm"
                : "text-[var(--color-muted)] hover:text-[var(--color-ink)]",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
