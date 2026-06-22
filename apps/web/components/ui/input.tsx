import * as React from "react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]/70 px-3.5 text-[var(--color-ink)] placeholder:text-[var(--color-faint)] transition-colors focus-visible:outline-none focus-visible:border-[var(--color-signal-dim)] focus-visible:ring-2 focus-visible:ring-[var(--color-signal)]/30";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, "h-11", className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      fieldBase,
      "min-h-40 resize-y py-3 font-mono text-sm leading-relaxed scroll-thin",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
