/**
 * @fileoverview The HTTP/SSE wire contract between `apps/api` and `apps/web`.
 *
 * These are the only types that cross the network boundary. They are kept
 * deliberately small and JSON-serializable — the web app re-declares the same
 * shapes in `apps/web/lib/protocol.ts` (it talks to the API over HTTP and must
 * not import API/core internals, per the repo dependency rules).
 */

/** The kinds of input the parser accepts (mirrors core's `InputKind`). */
export type SourceKind = "openapi" | "graphql" | "repo";

/** Transport baked into the generated server. */
export type Transport = "stdio" | "http";

/** Auth handling for the generated server. */
export type AuthMode = "apikey" | "oauth" | "none";

/** A single detected tool, flattened for the review panel. */
export interface ToolSummary {
  /** Original, parser-assigned name (stable id used to apply edits). */
  readonly name: string;
  readonly description: string;
  /** Human-readable origin, e.g. `GET /pets` or `Query.listPets`. */
  readonly locator: string;
  /** Operation verb/protocol shown as a badge. */
  readonly method: string;
  /** Confidence in [0,1]; low-confidence candidates are flagged in the UI. */
  readonly confidence: number;
  /** Number of input parameters. */
  readonly paramCount: number;
}

/** Result of `POST /api/parse`. */
export interface ParseResponse {
  readonly kind: SourceKind;
  readonly title?: string;
  readonly version?: string;
  readonly description?: string;
  readonly servers?: readonly string[];
  readonly warnings?: readonly string[];
  readonly tools: readonly ToolSummary[];
}

/** One edit the user made in the review panel, keyed by original `name`. */
export interface ToolEdit {
  readonly name: string;
  readonly enabled: boolean;
  /** Renamed tool name (sanitized server-side). */
  readonly newName?: string;
  /** Edited description. */
  readonly description?: string;
}

/** Body of `POST /api/jobs`. */
export interface CreateJobRequest {
  /** Raw spec/schema content, or an http(s) URL the server fetches. */
  readonly source: string;
  /** Optional explicit kind; otherwise sniffed from the content. */
  readonly kind?: SourceKind;
  readonly transport: Transport;
  readonly auth: AuthMode;
  /** Use Claude for generation (server falls back to deterministic if no key). */
  readonly useAi?: boolean;
  /** Run the install→build→boot→smoke verification loop. */
  readonly verify?: boolean;
  readonly tools?: readonly ToolEdit[];
}

/** Lifecycle phase of a job. */
export type JobPhase =
  | "queued"
  | "parsing"
  | "generating"
  | "verifying"
  | "done"
  | "error";

/** A coarse pipeline stage (drives the stepped progress UI). */
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

/** Final summary delivered on success. */
export interface JobSummary {
  readonly serverName: string;
  readonly toolCount: number;
  readonly transport: Transport;
  readonly usedFallback: boolean;
  readonly note: string;
  readonly files: readonly string[];
  readonly verification:
    | {
        readonly ok: boolean;
        readonly passes: number;
        readonly repairs: number;
      }
    | "skipped";
}

/** Streamed job events (sent as SSE `data:` JSON lines). */
export type JobEvent =
  | { readonly type: "phase"; readonly phase: JobPhase }
  | {
      readonly type: "stage";
      readonly group: "generate" | "verify";
      readonly stage: StageKey;
      readonly state: StageState;
      readonly detail?: string;
      readonly durationMs?: number;
    }
  | { readonly type: "log"; readonly line: string }
  | {
      readonly type: "repair";
      readonly file: string;
      readonly applied: boolean;
      readonly note?: string;
    }
  | { readonly type: "done"; readonly summary: JobSummary }
  | { readonly type: "error"; readonly message: string };

/** Snapshot returned by `GET /api/jobs/:id`. */
export interface JobStatus {
  readonly id: string;
  readonly phase: JobPhase;
  readonly events: readonly JobEvent[];
  readonly summary?: JobSummary;
  readonly error?: string;
}
