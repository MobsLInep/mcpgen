/**
 * `mcpgen generate <source> --out <dir>` — parse a source and render a complete
 * MCP server project to disk, then (by default) prove it actually runs.
 *
 * The LLM is optional: with an API key we use Claude (responses cached under
 * `<out>/.mcpgen-cache` so re-runs are cheap and resumable); without one — or
 * with `--offline` — generation falls back to deterministic, LLM-free
 * synthesis so the command always works.
 *
 * After generation the verification loop (`--verify`, on by default) installs,
 * builds, boots, and smoke-calls the generated server in a temp dir, repairing
 * failures with the model up to `--max-repairs` times. On success any repaired
 * files are written back to `<out>`; on failure a `VERIFICATION_REPORT.md` is
 * written and the command exits non-zero.
 */
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type AuthMode,
  type GeneratedProject,
  type LlmClient,
  type StageName,
  type VerifyEvent,
  FileResponseStore,
  cachingClient,
  createAnthropicClient,
  detectSource,
  generateProject,
  resolveModel,
  verifyProject,
  writeProject,
} from "@mcpgen/core";

export type { AuthMode } from "@mcpgen/core";

export interface GenerateOptions {
  out: string;
  transport?: "http" | "stdio";
  auth?: AuthMode;
  offline?: boolean;
  model?: string;
  /** Run the post-generation verification loop (default: caller decides). */
  verify?: boolean;
  /** Cap on self-repair iterations (default 3). */
  maxRepairs?: number;
  /** Sink for human-readable progress lines (default: stderr). */
  log?: (line: string) => void;
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

const STAGE_LABELS: Record<StageName, string> = {
  install: "install deps",
  build: "build",
  boot: "boot + tools/list",
  smoke: "smoke-call tools",
};

/** Turn a verification event into a human-readable progress line. */
function formatEvent(event: VerifyEvent): string | undefined {
  switch (event.type) {
    case "pass-start":
      return `\n  pass ${event.pass}:`;
    case "stage-start":
      return `    ⏳ ${STAGE_LABELS[event.stage]}…`;
    case "stage-result":
      return `    ${event.ok ? "✅" : "❌"} ${STAGE_LABELS[event.stage]} — ${
        event.detail
      } (${event.durationMs}ms)`;
    case "repair-start":
      return `    🔧 repairing ${event.file} (${event.stage} failure)…`;
    case "repair-result":
      return event.applied
        ? `    ✏️  applied patch to ${event.file}`
        : `    ⚠️  could not repair ${event.file}${
            event.note ? ` — ${event.note}` : ""
          }`;
    case "done":
      return event.ok
        ? `\n  ✅ verification passed in ${event.passes} pass(es), ${event.repairsApplied} repair(s).`
        : `\n  ❌ verification failed after ${event.passes} pass(es), ${event.repairsApplied} repair(s).`;
    default:
      return undefined;
  }
}

/** Machine-readable result of a generate run (drives --json and the panel). */
export interface GenerateSummary {
  serverName: string;
  toolCount: number;
  outDir: string;
  note: string;
  usedFallback: boolean;
  transport: "stdio" | "http";
  files: string[];
  verification: { ok: boolean; passes: number; repairs: number } | "skipped";
  /** Set when verification failed and a report was written. */
  reportPath?: string;
}

/**
 * Run the generate command. Returns `{ output, ok, summary }`; `ok` is false
 * only when verification ran and did not pass, so the caller can set a non-zero
 * exit code. `summary` is structured for `--json` and the rendered panel.
 */
export async function runGenerate(
  source: string,
  options: GenerateOptions,
): Promise<{ output: string; ok: boolean; summary: GenerateSummary }> {
  const outDir = resolve(options.out);
  const log = options.log ?? ((line) => process.stderr.write(`${line}\n`));
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

  const transport = options.transport ?? "stdio";
  const summary: GenerateSummary = {
    serverName: project.serverName,
    toolCount: project.toolCount,
    outDir,
    note,
    usedFallback: project.usedFallback,
    transport,
    files: [...project.files.keys()].sort(),
    verification: "skipped",
  };

  if (!options.verify) {
    return { output: lines.join("\n"), ok: true, summary };
  }

  log("\nVerifying the generated server (install → build → boot → smoke):");
  const verification = await verifyProject(parsed, project.plan, project, {
    client,
    maxRepairs: options.maxRepairs ?? 3,
    onEvent: (event) => {
      const line = formatEvent(event);
      if (line !== undefined) log(line);
    },
  });

  // Persist any repaired files back to the output directory.
  if (verification.repairsApplied > 0) {
    writeProject({ ...project, files: verification.files }, outDir);
  }

  if (verification.ok) {
    summary.verification = {
      ok: true,
      passes: verification.passes,
      repairs: verification.repairsApplied,
    };
    lines.push(
      "",
      `Verified: installed, built, booted, and smoke-called every tool` +
        ` (${verification.passes} pass(es), ${verification.repairsApplied} repair(s)).`,
    );
    return { output: lines.join("\n"), ok: true, summary };
  }

  // Failure: write the report next to the generated server.
  const reportPath = join(outDir, "VERIFICATION_REPORT.md");
  writeFileSync(reportPath, verification.report);
  summary.verification = {
    ok: false,
    passes: verification.passes,
    repairs: verification.repairsApplied,
  };
  summary.reportPath = reportPath;
  lines.push(
    "",
    `Verification FAILED after ${verification.passes} pass(es).`,
    `See ${reportPath} for the failing stage and full logs.`,
  );
  return { output: lines.join("\n"), ok: false, summary };
}
