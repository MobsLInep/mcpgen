"use client";

import {
  CheckCircle2,
  Download,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import type { JobSummary } from "@/lib/protocol";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { downloadUrl, fetchConfig } from "@/lib/api";
import { FileViewer } from "./file-viewer";
import { DeployPanel } from "./deploy-panel";

export function ResultPanel({
  jobId,
  summary,
  files,
  onReset,
}: {
  jobId: string;
  summary: JobSummary;
  files: Record<string, string>;
  onReset: () => void;
}) {
  const verification = summary.verification;

  return (
    <div className="space-y-6" data-testid="result-panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-[var(--color-signal)]" />
            <h3 className="text-xl font-semibold tracking-tight">
              {summary.serverName}
            </h3>
          </div>
          <p className="text-sm text-[var(--color-muted)]">
            {summary.toolCount} tool{summary.toolCount === 1 ? "" : "s"} ·{" "}
            {summary.transport} transport · {summary.note}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {verification === "skipped" ? (
              <Badge variant="neutral">verification skipped</Badge>
            ) : verification.ok ? (
              <Badge variant="signal">
                <ShieldCheck className="h-3.5 w-3.5" /> verified · installs,
                builds, boots
              </Badge>
            ) : (
              <Badge variant="amber">
                <ShieldAlert className="h-3.5 w-3.5" /> verification failed —
                report included
              </Badge>
            )}
            {summary.usedFallback && (
              <Badge variant="amber">fallback synthesis used</Badge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => {
              window.location.href = downloadUrl(jobId);
            }}
            data-testid="download-zip"
          >
            <Download className="h-4 w-4" />
            Download .zip
          </Button>
          <CopyButton
            variant="secondary"
            label="Copy Claude Desktop config"
            copiedLabel="Config copied"
            data-testid="copy-config"
            getText={async () =>
              JSON.stringify(await fetchConfig(jobId), null, 2)
            }
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={onReset}
            aria-label="Start over"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <FileViewer files={files} />

      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)]/40 p-5">
        <DeployPanel />
      </div>
    </div>
  );
}
