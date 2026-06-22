/**
 * @fileoverview The mcpgen template registry and renderer.
 *
 * Templates for the generated MCP server live as real files under
 * `packages/templates/files/*.tmpl` so they are diffable and testable on their
 * own. They are intentionally NOT TypeScript-compiled here (the `.tmpl`
 * extension keeps them out of `tsc`/ESLint); `packages/core` reads and renders
 * them when assembling a project.
 *
 * Rendering is a deliberately tiny `{{TOKEN}}` substitution — no logic lives in
 * templates, keeping all generation decisions in `core`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Describes a single MCP server code template. */
export interface TemplateDescriptor {
  /** Template file name, e.g. "server.ts.tmpl". */
  id: string;
  /** Human-readable summary of what the template produces. */
  description: string;
}

/**
 * Registered templates. Each `id` is a file under {@link templatesDir}.
 */
export const templates: TemplateDescriptor[] = [
  { id: "package.json.tmpl", description: "Generated server package manifest" },
  { id: "tsconfig.json.tmpl", description: "TypeScript config for the server" },
  { id: "server.ts.tmpl", description: "MCP server entry (stdio + Streamable HTTP)" },
  { id: "http.ts.tmpl", description: "Safe upstream HTTP client" },
  { id: "runtime.ts.tmpl", description: "Shared tool/runtime types" },
  { id: "config.ts.tmpl", description: "Environment-driven configuration" },
  { id: "tools-index.ts.tmpl", description: "Tool registry aggregator" },
  { id: "tool.ts.tmpl", description: "Per-tool module (schema + handler)" },
  { id: "env.example.tmpl", description: "Example environment file" },
  { id: "Dockerfile.tmpl", description: "Container build for the server" },
  { id: "gitignore.tmpl", description: "Ignore file for generated projects" },
  { id: "README.md.tmpl", description: "Generated server README" },
  { id: "SECURITY.md.tmpl", description: "Operator security review notes" },
];

/** Absolute path to the directory holding the `.tmpl` files. */
export function templatesDir(): string {
  // Resolves to `<package root>/files` from both `src/` (tests, via the vitest
  // alias) and `dist/` (built output) — `../files` is correct in both cases.
  return fileURLToPath(new URL("../files", import.meta.url));
}

/** Read the raw contents of a template by id (file name). */
export function loadTemplate(id: string): string {
  return readFileSync(`${templatesDir()}/${id}`, "utf8");
}

/**
 * Render a template, replacing every `{{KEY}}` with `vars[KEY]`. An unknown
 * `{{KEY}}` (one with no matching var) is left untouched so missing
 * substitutions are visible in the output rather than silently blanked.
 */
export function renderTemplate(
  id: string,
  vars: Record<string, string>,
): string {
  return loadTemplate(id).replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key]! : match,
  );
}

/** Render an in-memory template string (same `{{KEY}}` rules as {@link renderTemplate}). */
export function renderString(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key]! : match,
  );
}
