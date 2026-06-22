/**
 * `mcpgen generate <source> --out <dir>` — parse a source and render a complete
 * MCP server project to disk.
 *
 * The LLM is optional: with an API key we use Claude (responses cached under
 * `<out>/.mcpgen-cache` so re-runs are cheap and resumable); without one — or
 * with `--offline` — generation falls back to deterministic, LLM-free
 * synthesis so the command always works.
 */
import { join, resolve } from "node:path";
import {
  type AuthMode,
  type GeneratedProject,
  type LlmClient,
  FileResponseStore,
  cachingClient,
  createAnthropicClient,
  detectSource,
  generateProject,
  resolveModel,
  writeProject,
} from "@mcpgen/core";

export type { AuthMode } from "@mcpgen/core";

export interface GenerateOptions {
  out: string;
  transport?: "http" | "stdio";
  auth?: AuthMode;
  offline?: boolean;
  model?: string;
}

/** Build the LLM client, or undefined for offline/no-key generation. */
async function buildClient(
  outDir: string,
  options: GenerateOptions,
): Promise<{ client?: LlmClient; note: string }> {
  if (options.offline) {
    return { note: "offline mode — deterministic generation (no LLM)" };
  }
  const apiKey =
    process.env.MCPGEN_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      note: "no API key found (ANTHROPIC_API_KEY) — deterministic generation (no LLM)",
    };
  }
  const model = options.model ?? resolveModel();
  const anthropic = await createAnthropicClient({ apiKey, model });
  const store = new FileResponseStore(join(resolve(outDir), ".mcpgen-cache"));
  return {
    client: cachingClient(anthropic, store),
    note: `using model ${model} (responses cached in .mcpgen-cache)`,
  };
}

/** Render a compact tree of the generated files. */
export function formatTree(project: GeneratedProject): string {
  const paths = [...project.files.keys()].sort();
  return paths.map((p) => `  ${p}`).join("\n");
}

/** Run the generate command and return what to print to stdout. */
export async function runGenerate(
  source: string,
  options: GenerateOptions,
): Promise<string> {
  const outDir = resolve(options.out);
  const parsed = await (await detectSource(resolve(source))).parse();
  const { client, note } = await buildClient(outDir, options);

  const project = await generateProject(parsed, {
    client,
    transport: options.transport ?? "stdio",
    auth: options.auth,
  });

  writeProject(project, outDir);

  const lines = [
    `Generated ${project.toolCount} tool(s) for "${project.serverName}" (${note}).`,
    `Output: ${outDir}`,
    "",
    formatTree(project),
  ];
  if (project.usedFallback) {
    lines.push(
      "",
      "Note: some tools used deterministic fallback synthesis — review SECURITY.md.",
    );
  }
  return lines.join("\n");
}
