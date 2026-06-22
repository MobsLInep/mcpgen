import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badge = cva(
  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-xs font-medium tracking-wide",
  {
    variants: {
      variant: {
        neutral:
          "border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-muted)]",
        signal:
          "border-[var(--color-signal-dim)] bg-[var(--color-signal)]/10 text-[var(--color-signal)]",
        violet:
          "border-[var(--color-violet)]/40 bg-[var(--color-violet)]/10 text-[var(--color-violet)]",
        amber:
          "border-[var(--color-amber)]/40 bg-[var(--color-amber)]/10 text-[var(--color-amber)]",
        danger:
          "border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badge> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badge({ variant }), className)} {...props} />;
}
