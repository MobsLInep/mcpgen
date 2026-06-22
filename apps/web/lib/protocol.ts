/**
 * @fileoverview The API wire contract, mirrored on the client.
 *
 * The web app talks to `apps/api` only over HTTP (per the repo dependency
 * rules), so it cannot import the API package's internals. These types are a
 * hand-kept copy of `apps/api/src/protocol.ts` — keep the two in sync.
 */

export type SourceKind = "openapi" | "graphql" | "repo";
export type Transport = "stdio" | "http";
export type AuthMode = "apikey" | "oauth" | "none";

export interface ToolSummary {
  name: string;
  description: string;
  locator: string;
  method: string;
  confidence: number;
  paramCount: number;
}

export interface ParseResponse {
  kind: SourceKind;
  title?: string;
  version?: string;
  description?: string;
  servers?: string[];
  warnings?: string[];
  tools: ToolSummary[];
}

export interface ToolEdit {
  name: string;
  enabled: boolean;
  newName?: string;
  description?: string;
}

export interface CreateJobRequest {
  source: string;
  kind?: SourceKind;
  transport: Transport;
  auth: AuthMode;
  useAi?: boolean;
  verify?: boolean;
  tools?: ToolEdit[];
}

export type JobPhase =
  | "queued"
  | "parsing"
  | "generating"
  | "verifying"
  | "done"
  | "error";

export type StageKey =
  | "parse"
  | "plan"
  | "synthesize"
  | "assemble"
  | "install"
  | "build"
  | "boot"
  | "smoke";

export type StageState = "start" | "ok" | "fail";

export interface JobSummary {
  serverName: string;
  toolCount: number;
  transport: Transport;
  usedFallback: boolean;
  note: string;
  files: string[];
  verification: { ok: boolean; passes: number; repairs: number } | "skipped";
}

export type JobEvent =
  | { type: "phase"; phase: JobPhase }
  | {
      type: "stage";
      group: "generate" | "verify";
      stage: StageKey;
      state: StageState;
      detail?: string;
      durationMs?: number;
    }
  | { type: "log"; line: string }
  | { type: "repair"; file: string; applied: boolean; note?: string }
  | { type: "done"; summary: JobSummary }
  | { type: "error"; message: string };
