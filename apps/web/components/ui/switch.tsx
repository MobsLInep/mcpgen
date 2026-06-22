"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
  id?: string;
}

/** A small accessible toggle, themed to the signal color when on. */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  ...aria
}: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={aria["aria-label"]}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-signal)]/40 disabled:opacity-50",
        checked
          ? "border-[var(--color-signal-dim)] bg-[var(--color-signal)]/80"
          : "border-[var(--color-line)] bg-[var(--color-surface-2)]",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-[var(--color-canvas)] shadow transition-transform",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}
