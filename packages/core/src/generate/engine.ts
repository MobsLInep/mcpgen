/**
 * @fileoverview The generation engine — orchestrates plan → synthesize →
 * assemble, and writes the result to disk.
 *
 * The engine is provider-agnostic: pass an {@link LlmClient} to use Claude, or
 * omit it to run a fully deterministic, LLM-free generation (the same fallback
 * path used when the model is unavailable). This makes the whole pipeline
 * runnable in tests and CI without an API key.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ParseResult, ToolCandidate } from "../ir.js";
import { sanitizeToolName, uniqueName } from "../ir.js";
import { createLogger, emitTelemetry } from "../observability.js";
import type { AuthMode, GeneratedProject } from "./assemble.js";
import { assembleProject } from "./assemble.js";
import type { LlmClient } from "./llm.js";
import type { Plan } from "./plan.js";
import { runPlan } from "./plan.js";
import { synthesizeTool } from "./synthesize.js";

export type { GeneratedProject, AuthMode } from "./assemble.js";

/** Options for {@link generateProject}. */
export interface GenerateOptions {
  /** LLM client; omit for deterministic, LLM-free generation. */
  readonly client?: LlmClient;
  /** Transport baked into the generated config (default `stdio`). */
  readonly transport?: "stdio" | "http";
  /** Auth handling override; omit to derive from the source. */
  readonly auth?: AuthMode;
}

/** Build a deterministic plan from the IR (no LLM). */
export function fallbackPlan(result: ParseResult): Plan {
  const used = new Set<string>();
  const tools = result.tools.map((candidate) => ({
    sourceName: candidate.name,
    toolName: uniqueName(sanitizeToolName(candidate.name), used),
    title: candidate.name,
    description: candidate.description,
  }));
  const base = result.metadata.title
    ? sanitizeToolName(result.metadata.title).toLowerCase()
    : "mcp-server";
  return {
    serverName: `${base}-mcp`,
    serverDescription:
      result.metadata.description ??
      `MCP server generated from ${result.metadata.kind} source.`,
    tools,
  };
}

/** Run the full pipeline and return the in-memory project (no disk I/O). */
export async function generateProject(
  result: ParseResult,
  options: GenerateOptions = {},
): Promise<GeneratedProject> {
  const log = createLogger("generate");
  const transport = options.transport ?? "stdio";
  // Telemetry is a no-op unless MCPGEN_TELEMETRY=1; properties are PII-free
  // (source *kind*, transport, counts — never titles, paths, or spec content).
  emitTelemetry("generate.start", {
    sourceKind: result.metadata.kind,
    transport,
    toolCandidates: result.tools.length,
    withLlm: Boolean(options.client),
  });

  const candidatesByName = new Map<string, ToolCandidate>(
    result.tools.map((t) => [t.name, t]),
  );

  const plan = options.client
    ? await runPlan(options.client, result)
    : fallbackPlan(result);

  const toolCode = await Promise.all(
    plan.tools.map((planned) =>
      synthesizeTool(
        options.client,
        candidatesByName.get(planned.sourceName)!,
        planned,
      ),
    ),
  );

  const project = assembleProject(result, plan, toolCode, candidatesByName, {
    transport,
    auth: options.auth,
  });

  log.debug("assembled project", {
    serverName: project.serverName,
    toolCount: project.toolCount,
  });
  emitTelemetry("generate.complete", {
    sourceKind: result.metadata.kind,
    transport,
    toolCount: project.toolCount,
    usedFallback: project.usedFallback,
    ok: true,
  });
  return project;
}

/**
 * Write a generated project to `outDir`. Returns the absolute paths written.
 * Creates parent directories as needed; existing files are overwritten.
 */
export function writeProject(
  project: GeneratedProject,
  outDir: string,
): string[] {
  const root = resolve(outDir);
  const written: string[] = [];
  for (const [relativePath, contents] of project.files) {
    const target = join(root, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
    written.push(target);
  }
  return written.sort();
}
