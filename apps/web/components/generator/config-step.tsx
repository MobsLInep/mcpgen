"use client";

import type { AuthMode, Transport } from "@/lib/protocol";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";

export interface GenConfig {
  transport: Transport;
  auth: AuthMode;
  useAi: boolean;
  verify: boolean;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)]/40 p-4">
      <div className="max-w-md">
        <p className="text-sm font-medium text-[var(--color-ink)]">{label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-faint)]">
          {hint}
        </p>
      </div>
      {children}
    </div>
  );
}

export function ConfigStep({
  config,
  onChange,
}: {
  config: GenConfig;
  onChange: (config: GenConfig) => void;
}) {
  return (
    <div className="space-y-3">
      <Field
        label="Transport"
        hint="stdio launches per-call (Claude Desktop, Cursor). HTTP runs as a streamable server you host."
      >
        <Segmented<Transport>
          aria-label="Transport"
          value={config.transport}
          onChange={(transport) => onChange({ ...config, transport })}
          options={[
            { value: "stdio", label: "stdio" },
            { value: "http", label: "HTTP" },
          ]}
        />
      </Field>

      <Field
        label="Authentication"
        hint="How the generated server authenticates to your upstream API. Credentials are read from environment variables — never baked in."
      >
        <Segmented<AuthMode>
          aria-label="Authentication"
          value={config.auth}
          onChange={(auth) => onChange({ ...config, auth })}
          options={[
            { value: "none", label: "None" },
            { value: "apikey", label: "API key" },
            { value: "oauth", label: "OAuth" },
          ]}
        />
      </Field>

      <Field
        label="Generate with Claude"
        hint="Use the LLM engine for richer handlers and descriptions. Falls back to deterministic synthesis if no server key is set."
      >
        <Switch
          aria-label="Generate with Claude"
          checked={config.useAi}
          onCheckedChange={(useAi) => onChange({ ...config, useAi })}
        />
      </Field>

      <Field
        label="Verify the generated server"
        hint="Install, build, boot, and smoke-call every tool in a sandbox before you download. Slower, but proves it runs."
      >
        <Switch
          aria-label="Verify the generated server"
          checked={config.verify}
          onCheckedChange={(verify) => onChange({ ...config, verify })}
        />
      </Field>
    </div>
  );
}
