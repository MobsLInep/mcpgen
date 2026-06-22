"use client";

import { useMemo, useState } from "react";
import { File, FileCode, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

function iconFor(path: string) {
  if (/\.(ts|tsx|js|mjs|json)$/.test(path)) return FileCode;
  if (/\.md$/.test(path)) return FileText;
  return File;
}

export function FileViewer({ files }: { files: Record<string, string> }) {
  const paths = useMemo(() => Object.keys(files).sort(), [files]);
  const [selected, setSelected] = useState(
    () => paths.find((p) => p.endsWith("server.ts")) ?? paths[0] ?? "",
  );

  return (
    <div className="grid overflow-hidden rounded-xl border border-[var(--color-line)] md:grid-cols-[minmax(180px,240px)_1fr]">
      <nav
        className="max-h-[26rem] overflow-y-auto border-b border-[var(--color-line)] bg-[var(--color-canvas)]/50 p-2 scroll-thin md:border-b-0 md:border-r"
        aria-label="Generated files"
      >
        <ul className="space-y-0.5">
          {paths.map((path) => {
            const Icon = iconFor(path);
            const active = path === selected;
            return (
              <li key={path}>
                <button
                  type="button"
                  onClick={() => setSelected(path)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-xs transition-colors",
                    active
                      ? "bg-[var(--color-signal)]/12 text-[var(--color-signal)]"
                      : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]",
                  )}
                  title={path}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  <span className="truncate">{path}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="min-w-0 bg-[var(--color-canvas)]/30">
        <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-4 py-2">
          <span className="font-mono text-xs text-[var(--color-faint)]">
            {selected}
          </span>
          <span className="font-mono text-xs text-[var(--color-faint)]">
            {selected
              ? `${files[selected]?.split("\n").length ?? 0} lines`
              : ""}
          </span>
        </div>
        <pre className="max-h-[23rem] overflow-auto p-4 text-xs leading-relaxed scroll-thin">
          <code className="font-mono text-[var(--color-ink)]/90">
            {selected ? files[selected] : "Select a file"}
          </code>
        </pre>
      </div>
    </div>
  );
}
