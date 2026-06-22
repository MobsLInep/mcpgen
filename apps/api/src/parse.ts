/**
 * @fileoverview Turning a web request into a core `Source` + IR.
 *
 * The browser never sends a filesystem path: it either pastes spec/schema text
 * or gives an http(s) URL we fetch server-side (so CORS and any future auth stay
 * off the client). We then sniff the kind (mirroring core's `detect.ts`, which
 * is path-based and not reusable here) and hand off to the right core parser.
 *
 * Repo (`code`) input is intentionally CLI-only — it needs a directory tree the
 * browser can't provide — so the web flow supports OpenAPI and GraphQL.
 */
import {
  graphqlSource,
  openApiSource,
  type ParseResult,
  type Source,
  type ToolCandidate,
} from "@mcpgen/core";
import type {
  ParseResponse,
  SourceKind,
  ToolEdit,
  ToolSummary,
} from "./protocol.js";

export class ParseInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseInputError";
  }
}

const MAX_FETCH_BYTES = 5_000_000; // 5 MB ceiling on remote specs.

/** Whether a string is an http(s) URL we should fetch rather than parse. */
function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

/** Fetch a remote spec, guarding against oversized or non-OK responses. */
async function fetchRemote(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      headers: {
        accept: "application/json, application/yaml, text/plain, */*",
      },
    });
  } catch (err) {
    throw new ParseInputError(
      `Could not fetch "${url}": ${(err as Error).message}`,
    );
  }
  if (!res.ok) {
    throw new ParseInputError(`Fetching "${url}" returned HTTP ${res.status}.`);
  }
  const text = await res.text();
  if (text.length > MAX_FETCH_BYTES) {
    throw new ParseInputError("Remote spec exceeds the 5 MB size limit.");
  }
  return text;
}

/** Best-effort content sniffing (web inputs carry no file extension). */
function classify(content: string): SourceKind | undefined {
  const trimmed = content.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(content) as Record<string, unknown> & {
        data?: { __schema?: unknown };
      };
      if (obj.openapi || obj.swagger) return "openapi";
      if (obj.__schema || obj.data?.__schema) return "graphql";
    } catch {
      // fall through to heuristics
    }
  }
  if (/^\s*(openapi|swagger)\s*:/m.test(content)) return "openapi";
  if (/\b(type\s+Query|type\s+Mutation|schema\s*\{)/.test(content)) {
    return "graphql";
  }
  return undefined;
}

/** Resolve a web request into a core `Source` and its detected kind. */
export async function resolveSource(input: {
  source: string;
  kind?: SourceKind;
}): Promise<{ source: Source; kind: SourceKind; content: string }> {
  const raw = input.source?.trim();
  if (!raw) throw new ParseInputError("No source provided.");

  const content = isUrl(raw) ? await fetchRemote(raw) : raw;
  const kind = input.kind ?? classify(content);

  if (kind === "openapi") {
    return { source: openApiSource({ content }), kind, content };
  }
  if (kind === "graphql") {
    return { source: graphqlSource({ content }), kind, content };
  }
  if (kind === "repo") {
    throw new ParseInputError(
      "Repository input is only supported via the `mcpgen` CLI, not the web UI.",
    );
  }
  throw new ParseInputError(
    "Could not detect the input type. Expected an OpenAPI spec (JSON/YAML) or a GraphQL schema (SDL or introspection).",
  );
}

/** A short, badge-friendly label for a tool's underlying operation. */
function operationLabel(candidate: ToolCandidate): string {
  const op = candidate.operation;
  return op.protocol === "http" ? op.method : op.operation.toUpperCase();
}

/** Project a core `ParseResult` into the web's flattened `ParseResponse`. */
export function toParseResponse(
  result: ParseResult,
  kind: SourceKind,
): ParseResponse {
  const tools: ToolSummary[] = result.tools.map((t) => ({
    name: t.name,
    description: t.description,
    locator: t.provenance.locator,
    method: operationLabel(t),
    confidence: t.confidence,
    paramCount: t.parameters.length,
  }));
  return {
    kind,
    title: result.metadata.title,
    version: result.metadata.version,
    description: result.metadata.description,
    servers: result.metadata.servers,
    warnings: result.metadata.warnings,
    tools,
  };
}

/**
 * Apply the review-panel edits to a parsed IR: drop disabled tools, rename, and
 * override descriptions. Names are re-sanitized and de-duplicated downstream by
 * the engine, but we keep edits minimal and predictable here.
 */
export function applyEdits(
  result: ParseResult,
  edits: readonly ToolEdit[] | undefined,
): ParseResult {
  if (!edits || edits.length === 0) return result;
  const byName = new Map(edits.map((e) => [e.name, e]));
  const tools = result.tools
    .filter((t) => byName.get(t.name)?.enabled !== false)
    .map((t) => {
      const edit = byName.get(t.name);
      if (!edit) return t;
      return {
        ...t,
        name: edit.newName?.trim() ? edit.newName.trim() : t.name,
        description: edit.description?.trim()
          ? edit.description.trim()
          : t.description,
      };
    });
  return {
    metadata: { ...result.metadata, toolCount: tools.length },
    tools,
  };
}
