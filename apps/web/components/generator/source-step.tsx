"use client";

import { useRef } from "react";
import { ArrowRight, Loader2, Upload } from "lucide-react";
import type { SourceKind } from "@/lib/protocol";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { SAMPLE_PETSTORE, SAMPLE_GRAPHQL } from "@/lib/samples";

export type KindChoice = SourceKind | "auto";

export function SourceStep({
  source,
  kind,
  loading,
  error,
  onSourceChange,
  onKindChange,
  onSubmit,
}: {
  source: string;
  kind: KindChoice;
  loading: boolean;
  error?: string;
  onSourceChange: (value: string) => void;
  onKindChange: (kind: KindChoice) => void;
  onSubmit: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const isUrl = /^https?:\/\//i.test(source.trim());

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<KindChoice>
          aria-label="Input type"
          value={kind}
          onChange={onKindChange}
          options={[
            { value: "auto", label: "Auto-detect" },
            { value: "openapi", label: "OpenAPI" },
            { value: "graphql", label: "GraphQL" },
          ]}
        />
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".json,.yaml,.yml,.graphql,.gql,.txt"
            className="hidden"
            data-testid="file-input"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) onSourceChange(await file.text());
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            Upload file
          </Button>
        </div>
      </div>

      <Textarea
        value={source}
        data-testid="source-input"
        onChange={(e) => onSourceChange(e.target.value)}
        placeholder={`Paste an OpenAPI spec (JSON/YAML) or GraphQL schema — or a https:// URL to one…`}
        className="min-h-56"
        spellCheck={false}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-faint)]">
        <span className="eyebrow">Try a sample</span>
        <button
          type="button"
          className="rounded-md border border-[var(--color-line)] px-2.5 py-1 font-mono hover:border-[var(--color-signal-dim)] hover:text-[var(--color-signal)]"
          onClick={() => {
            onKindChange("openapi");
            onSourceChange(SAMPLE_PETSTORE);
          }}
        >
          petstore.openapi.json
        </button>
        <button
          type="button"
          className="rounded-md border border-[var(--color-line)] px-2.5 py-1 font-mono hover:border-[var(--color-signal-dim)] hover:text-[var(--color-signal)]"
          onClick={() => {
            onKindChange("graphql");
            onSourceChange(SAMPLE_GRAPHQL);
          }}
        >
          schema.graphql
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--color-faint)]">
          {isUrl
            ? "We'll fetch this URL on the server."
            : "Nothing leaves your browser until you hit Detect."}
        </p>
        <Button
          onClick={onSubmit}
          disabled={loading || source.trim().length === 0}
          data-testid="detect-button"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className="h-4 w-4" />
          )}
          {loading ? "Detecting…" : "Detect tools"}
        </Button>
      </div>
    </div>
  );
}
