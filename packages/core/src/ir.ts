/**
 * @fileoverview The mcpgen intermediate representation (IR).
 *
 * Every input parser (OpenAPI, GraphQL, code) normalizes its source into the
 * same shape: a {@link SourceMetadata} header plus a list of
 * {@link ToolCandidate}s. Downstream phases (rendering, deployment) consume the
 * IR and never touch the original input, so this file is the single contract
 * between "ingestion" and "generation".
 *
 * The IR is intentionally transport-agnostic at the edges: a tool candidate
 * carries enough binding information ({@link OperationBinding}) to later emit a
 * real HTTP or GraphQL call, but it does not itself perform any I/O.
 */

/** The kinds of input mcpgen can generate an MCP server from. */
export type InputKind = "openapi" | "graphql" | "repo";

/**
 * A JSON Schema fragment. We keep this deliberately loose — schemas flow
 * through mcpgen mostly untouched (dereferenced OpenAPI schemas, GraphQL types
 * mapped to JSON Schema) and are only fully interpreted when a template renders
 * them. `boolean` is allowed because JSON Schema permits `true`/`false` as whole
 * schemas (e.g. `additionalProperties: false`).
 */
export type JsonSchema = JsonSchemaObject | boolean;

/** Object form of {@link JsonSchema}. */
export interface JsonSchemaObject {
  [key: string]: unknown;
}

/** Uppercase HTTP method names used by HTTP-backed tools. */
export type HttpMethod =
  | "GET"
  | "PUT"
  | "POST"
  | "DELETE"
  | "PATCH"
  | "OPTIONS"
  | "HEAD"
  | "TRACE";

/**
 * How a tool maps back onto its underlying operation. This is the information a
 * generated MCP server needs to actually invoke the source API.
 */
export type OperationBinding =
  | {
      readonly protocol: "http";
      /** HTTP method to issue. */
      readonly method: HttpMethod;
      /** Path template, e.g. `/pets/{petId}`. */
      readonly path: string;
    }
  | {
      readonly protocol: "graphql";
      /** Whether this field lives on the query or mutation root. */
      readonly operation: "query" | "mutation";
      /** Root field name to select. */
      readonly field: string;
    };

/** Where a single tool parameter is carried on the wire. */
export type ParameterLocation =
  | "path"
  | "query"
  | "header"
  | "cookie"
  | "body"
  | "arg";

/** A single input parameter of a tool. */
export interface ParameterCandidate {
  /** Parameter name as the source declares it. */
  readonly name: string;
  /** Where the value is placed when calling the underlying operation. */
  readonly location: ParameterLocation;
  /** Whether the source marks this parameter as required. */
  readonly required: boolean;
  /** JSON Schema describing the accepted value. */
  readonly schema: JsonSchema;
  /** Human-readable description, when the source provides one. */
  readonly description?: string;
}

/**
 * An authentication requirement the caller must satisfy. Modeled closely on
 * OpenAPI security schemes but reused for any source that expresses auth.
 */
export interface AuthRequirement {
  /** Scheme family, e.g. `apiKey`, `http`, `oauth2`, `openIdConnect`. */
  readonly scheme: string;
  /** For `http` schemes, the auth scheme, e.g. `bearer` or `basic`. */
  readonly httpScheme?: string;
  /** For `apiKey` schemes, the parameter name carrying the key. */
  readonly name?: string;
  /** For `apiKey` schemes, where the key is carried. */
  readonly location?: "header" | "query" | "cookie";
  /** OAuth2 / OIDC scopes the operation requires. */
  readonly scopes?: readonly string[];
}

/**
 * Where a {@link ToolCandidate} came from. Provenance keeps a tool traceable to
 * its origin so the `inspect` command and later review steps can point a human
 * back at the exact operation/field/line that produced it.
 */
export interface Provenance {
  /** The input kind that produced this tool. */
  readonly sourceKind: InputKind;
  /**
   * A human-readable pointer to the origin, e.g. `GET /pets`,
   * `Query.listPets`, or `src/routes/users.ts:42`.
   */
  readonly locator: string;
  /** The original identifier (operationId, field name) before sanitization. */
  readonly identifier?: string;
  /** Source file path, when the origin is a file on disk. */
  readonly file?: string;
  /** 1-based line number within {@link file}, when known. */
  readonly line?: number;
}

/**
 * One candidate MCP tool, normalized from a single source operation. "Candidate"
 * because parsers may emit low-confidence guesses (especially the code parser);
 * a later phase decides which candidates become real tools.
 */
export interface ToolCandidate {
  /** Sanitized, MCP-safe tool name (unique within a parse result). */
  readonly name: string;
  /** Description shown to the agent; falls back to a generated summary. */
  readonly description: string;
  /** How to invoke the underlying operation. */
  readonly operation: OperationBinding;
  /** Flattened list of input parameters. */
  readonly parameters: readonly ParameterCandidate[];
  /** JSON Schema for the tool's combined input object. */
  readonly inputSchema: JsonSchema;
  /** JSON Schema for the tool's result, when the source describes one. */
  readonly outputSchema?: JsonSchema;
  /** Authentication requirements for invoking the operation. */
  readonly auth: readonly AuthRequirement[];
  /**
   * Confidence in the range `[0, 1]` that this candidate is a real, callable
   * operation. Structured sources (OpenAPI, GraphQL) score high; the code
   * parser's static guesses score lower. See {@link isLowConfidence}.
   */
  readonly confidence: number;
  /** Where this candidate came from. */
  readonly provenance: Provenance;
  /** Non-fatal issues encountered while deriving this candidate. */
  readonly warnings?: readonly string[];
}

/** Header describing the source as a whole. */
export interface SourceMetadata {
  /** Which parser produced the result. */
  readonly kind: InputKind;
  /** Source title, e.g. the OpenAPI `info.title`. */
  readonly title?: string;
  /** Source version, e.g. the OpenAPI `info.version`. */
  readonly version?: string;
  /** Source description. */
  readonly description?: string;
  /** Spec/schema dialect version, e.g. `3.0.3` for OpenAPI. */
  readonly specVersion?: string;
  /** Known base/server URLs for the API. */
  readonly servers?: readonly string[];
  /** Number of tool candidates produced (mirrors `tools.length`). */
  readonly toolCount: number;
  /** Free-form pointer to the source location (file path or directory). */
  readonly location?: string;
  /** Source-level, non-fatal warnings. */
  readonly warnings?: readonly string[];
}

/** The normalized output every parser produces. */
export interface ParseResult {
  readonly metadata: SourceMetadata;
  readonly tools: readonly ToolCandidate[];
}

/**
 * A parsable input source. The three parsers are exposed as factories that
 * return a `Source`; calling {@link Source.parse} runs the deterministic
 * parse and yields the IR. No LLM calls happen here — parsing is pure and
 * fully unit-testable.
 */
export interface Source {
  /** Which kind of source this is. */
  readonly kind: InputKind;
  /** Run the parse and return the normalized IR. */
  parse(): Promise<ParseResult>;
}

/** Confidence at or below this threshold is considered "low confidence". */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

/** Whether a candidate should be flagged as a low-confidence guess. */
export function isLowConfidence(candidate: ToolCandidate): boolean {
  return candidate.confidence <= LOW_CONFIDENCE_THRESHOLD;
}

/**
 * Sanitize an arbitrary identifier into an MCP-safe tool name. MCP tool names
 * are restricted to `[A-Za-z0-9_-]`; we map anything else to `_`, collapse
 * runs, and trim. Empty results fall back to `tool`.
 */
export function sanitizeToolName(raw: string): string {
  const cleaned = raw
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");
  return cleaned.length > 0 ? cleaned : "tool";
}

/**
 * Ensure a candidate name is unique within a set of already-used names,
 * appending `_2`, `_3`, … on collision. Mutates `used` to record the result.
 */
export function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  let candidate = `${base}_${n}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${base}_${n}`;
  }
  used.add(candidate);
  return candidate;
}
