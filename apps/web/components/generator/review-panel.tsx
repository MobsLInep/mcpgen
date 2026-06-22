"use client";

import { useState } from "react";
import { ChevronDown, Pencil } from "lucide-react";
import type { ParseResponse, ToolEdit } from "@/lib/protocol";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type EditMap = Record<string, ToolEdit>;

function methodVariant(method: string) {
  switch (method.toUpperCase()) {
    case "GET":
    case "QUERY":
      return "signal" as const;
    case "POST":
    case "PUT":
    case "PATCH":
    case "MUTATION":
      return "violet" as const;
    case "DELETE":
      return "danger" as const;
    default:
      return "neutral" as const;
  }
}

function ToolRow({
  tool,
  edit,
  onChange,
}: {
  tool: ParseResponse["tools"][number];
  edit: ToolEdit;
  onChange: (next: ToolEdit) => void;
}) {
  const [open, setOpen] = useState(false);
  const lowConfidence = tool.confidence <= 0.6;
  const name = edit.newName ?? tool.name;
  const description = edit.description ?? tool.description;

  return (
    <div
      className={cn(
        "rounded-xl border transition-colors",
        edit.enabled
          ? "border-[var(--color-line)] bg-[var(--color-surface)]/60"
          : "border-[var(--color-line-soft)] bg-transparent opacity-55",
      )}
    >
      <div className="flex items-center gap-3 p-3">
        <Switch
          checked={edit.enabled}
          onCheckedChange={(v) => onChange({ ...edit, enabled: v })}
          aria-label={`Include ${tool.name}`}
        />
        <Badge variant={methodVariant(tool.method)}>{tool.method}</Badge>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm text-[var(--color-ink)]">
            {name}
          </p>
          <p className="truncate text-xs text-[var(--color-faint)]">
            {tool.locator}
          </p>
        </div>
        {lowConfidence && (
          <Badge variant="amber" title="Low-confidence candidate">
            low confidence
          </Badge>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Edit tool"
          aria-expanded={open}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
        >
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <Pencil className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {open && (
        <div className="grid gap-3 border-t border-[var(--color-line-soft)] p-3 sm:grid-cols-[200px_1fr]">
          <label className="space-y-1.5">
            <span className="eyebrow">Tool name</span>
            <Input
              value={name}
              onChange={(e) => onChange({ ...edit, newName: e.target.value })}
              className="h-9 font-mono text-sm"
            />
          </label>
          <label className="space-y-1.5">
            <span className="eyebrow">Description</span>
            <Input
              value={description}
              onChange={(e) =>
                onChange({ ...edit, description: e.target.value })
              }
              className="h-9 text-sm"
            />
          </label>
        </div>
      )}
    </div>
  );
}

export function ReviewPanel({
  parsed,
  edits,
  onChange,
}: {
  parsed: ParseResponse;
  edits: EditMap;
  onChange: (edits: EditMap) => void;
}) {
  const enabledCount = parsed.tools.filter(
    (t) => edits[t.name]?.enabled !== false,
  ).length;

  const setAll = (enabled: boolean) => {
    const next: EditMap = {};
    for (const t of parsed.tools) {
      next[t.name] = {
        ...(edits[t.name] ?? { name: t.name, enabled }),
        enabled,
      };
    }
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--color-muted)]">
            <span className="font-mono text-[var(--color-signal)]">
              {enabledCount}
            </span>{" "}
            of {parsed.tools.length} operations selected
            {parsed.title ? ` from ${parsed.title}` : ""}.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => setAll(true)}
            className="rounded-md px-2 py-1 text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => setAll(false)}
            className="rounded-md px-2 py-1 text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1 scroll-thin">
        {parsed.tools.map((tool) => {
          const edit = edits[tool.name] ?? { name: tool.name, enabled: true };
          return (
            <ToolRow
              key={tool.name}
              tool={tool}
              edit={edit}
              onChange={(next) => onChange({ ...edits, [tool.name]: next })}
            />
          );
        })}
      </div>
    </div>
  );
}
