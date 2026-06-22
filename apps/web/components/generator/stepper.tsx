"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepId = "source" | "review" | "configure" | "result";

const STEPS: { id: StepId; label: string }[] = [
  { id: "source", label: "Source" },
  { id: "review", label: "Review tools" },
  { id: "configure", label: "Configure" },
  { id: "result", label: "Generate" },
];

export function Stepper({ current }: { current: StepId }) {
  const currentIndex = STEPS.findIndex((s) => s.id === current);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-3">
      {STEPS.map((step, i) => {
        const state =
          i < currentIndex ? "done" : i === currentIndex ? "active" : "todo";
        return (
          <li key={step.id} className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full border font-mono text-xs transition-colors",
                state === "done" &&
                  "border-[var(--color-signal-dim)] bg-[var(--color-signal)]/15 text-[var(--color-signal)]",
                state === "active" &&
                  "border-[var(--color-signal)] bg-[var(--color-signal)] text-[var(--color-signal-ink)]",
                state === "todo" &&
                  "border-[var(--color-line)] text-[var(--color-faint)]",
              )}
            >
              {state === "done" ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                "text-sm font-medium",
                state === "todo"
                  ? "text-[var(--color-faint)]"
                  : "text-[var(--color-ink)]",
              )}
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="mx-1 hidden h-px w-8 bg-[var(--color-line)] sm:block" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
