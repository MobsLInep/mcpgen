/**
 * @fileoverview Source detection.
 *
 * Given a filesystem path, sniff whether it is an OpenAPI spec, a GraphQL
 * schema/introspection, or a code repository, and return the matching
 * {@link Source}. This is the only place in core that touches the filesystem for
 * dispatch; the parsers themselves accept in-memory content too.
 */
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import type { InputKind, Source } from "./ir.js";
import { codeSource } from "./parsers/code.js";
import { graphqlSource } from "./parsers/graphql.js";
import { openApiSource } from "./parsers/openapi.js";

/** Error thrown when a path cannot be classified into a known source kind. */
export class UnknownSourceError extends Error {
  constructor(path: string) {
    super(
      `Could not detect source kind for "${path}". Expected an OpenAPI spec ` +
        `(.json/.yaml), a GraphQL schema (.graphql/.gql or introspection ` +
        `JSON), or a directory of code.`,
    );
    this.name = "UnknownSourceError";
  }
}

/** Decide the source kind for a file's content (already-read). */
function classifyContent(path: string, content: string): InputKind | undefined {
  const ext = extname(path).toLowerCase();
  if (ext === ".graphql" || ext === ".gql") return "graphql";

  const trimmed = content.trimStart();
  if (trimmed.startsWith("{")) {
    // JSON: OpenAPI specs carry `openapi`/`swagger`; introspection carries
    // `__schema` (optionally under `data`).
    try {
      const obj = JSON.parse(content) as Record<string, unknown> & {
        data?: { __schema?: unknown };
      };
      if (obj.openapi || obj.swagger) return "openapi";
      if (obj.__schema || obj.data?.__schema) return "graphql";
    } catch {
      // fall through to heuristics below
    }
  }

  // YAML / loose heuristics.
  if (/^\s*(openapi|swagger)\s*:/m.test(content)) return "openapi";
  if (/\b(type\s+Query|type\s+Mutation|schema\s*\{)/.test(content)) {
    return "graphql";
  }
  if (ext === ".yaml" || ext === ".yml") return "openapi";
  return undefined;
}

/**
 * Detect the kind of source at `path` (file or directory) and return the
 * corresponding {@link Source}. Directories are always treated as code repos.
 */
export async function detectSource(path: string): Promise<Source> {
  const info = await stat(path);
  if (info.isDirectory()) {
    return codeSource(path);
  }

  const content = await readFile(path, "utf8");
  const kind = classifyContent(path, content);
  switch (kind) {
    case "openapi":
      return openApiSource({ path });
    case "graphql":
      return graphqlSource({ content, location: path });
    default:
      throw new UnknownSourceError(path);
  }
}
