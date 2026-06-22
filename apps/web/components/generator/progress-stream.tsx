"use client";

import { useMemo } from "react";
import { Check, Loader2, X, Wrench } from "lucide-react";
import type { JobEvent, JobPhase, StageKey } from "@/lib/protocol";
import { cn } from "@/lib/utils";

const GENERATE_STAGES: { key: StageKey; label: string }[] = [
  { key: "parse", label: "Parse source" },
  { key: "plan", label: "Plan tools" },
  { key: "synthesize", label: "Synthesize handlers" },
  { key: "assemble", label: "Assemble project" },
];

const VERIFY_STAGES: { key: StageKey; label: string }[] = [
  { key: "install", label: "Install deps" },
  { key: "build", label: "Type-check & build" },
  { key: "boot", label: "Boot + tools/list" },
  { key: "smoke", label: "Smoke-call tools" },
];

interface StageView {
  state: "pending" | "running" | "ok" | "fail";
  detail?: string;
  durationMs?: number;
}

function StageRow({ label, view }: { label: string; view: StageView }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 transition-colors",
        view.state === "running" && "bg-[var(--color-surface-2)]",
      )}
    >
      <span className="flex h-5 w-5 items-center justify-center">
        {view.state === "ok" && (
          <Check className="h-4 w-4 text-[var(--color-signal)]" />
        )}
        {view.state === "fail" && (
          <X className="h-4 w-4 text-[var(--color-danger)]" />
        )}
        {view.state === "running" && (
          <Loader2 className="h-4 w-4 animate-spin text-[var(--color-signal)]" />
        )}
        {view.state === "pending" && (
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-line)]" />
        )}
      </span>
      <span
        className={cn(
          "text-sm",
          view.state === "pending"
            ? "text-[var(--color-faint)]"
            : "text-[var(--color-ink)]",
        )}
      >
        {label}
      </span>
      <span className="ml-auto flex items-center gap-3">
        {view.detail && (
          <span className="hidden font-mono text-xs text-[var(--color-muted)] sm:inline">
            {view.detail}
          </span>
        )}
        {view.durationMs !== undefined && (
          <span className="font-mono text-xs text-[var(--color-faint)]">
            {view.durationMs}ms
          </span>
        )}
      </span>
    </div>
  );
}

export function ProgressStream({
  events,
  phase,
}: {
  events: JobEvent[];
  phase: JobPhase;
}) {
  const { stages, repairs, showVerify } = useMemo(() => {
    const stages: Record<string, StageView> = {};
    const repairs: { file: string; applied: boolean; note?: string }[] = [];
    let showVerify = false;
    for (const e of events) {
      if (e.type === "stage") {
        if (e.group === "verify") showVerify = true;
        stages[e.stage] = {
          state:
            e.state === "start" ? "running" : e.state === "ok" ? "ok" : "fail",
          detail: e.detail ?? stages[e.stage]?.detail,
          durationMs: e.durationMs,
        };
      } else if (e.type === "repair") {
        repairs.push({ file: e.file, applied: e.applied, note: e.note });
      }
    }
    return { stages, repairs, showVerify };
  }, [events]);

  const view = (key: StageKey): StageView =>
    stages[key] ?? { state: "pending" };

  return (
    <div className="space-y-6" data-testid="progress-stream">
      <Group title="Generate" steps={GENERATE_STAGES} view={view} />
      {(showVerify || phase === "verifying") && (
        <Group title="Verify" steps={VERIFY_STAGES} view={view} />
      )}
      {repairs.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-[var(--color-amber)]/30 bg-[var(--color-amber)]/5 p-3">
          {repairs.map((r, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-xs text-[var(--color-amber)]"
            >
              <Wrench className="h-3.5 w-3.5" />
              <span className="font-mono">
                {r.applied ? "Repaired" : "Could not repair"} {r.file}
                {r.note ? ` — ${r.note}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Group({
  title,
  steps,
  view,
}: {
  title: string;
  steps: { key: StageKey; label: string }[];
  view: (key: StageKey) => StageView;
}) {
  return (
    <div>
      <p className="eyebrow mb-2">{title}</p>
      <div className="space-y-0.5">
        {steps.map((s) => (
          <StageRow key={s.key} label={s.label} view={view(s.key)} />
        ))}
      </div>
    </div>
  );
}
