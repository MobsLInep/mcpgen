/**
 * @fileoverview The self-correcting verification loop.
 *
 * After generation, {@link verifyProject} proves a generated MCP server actually
 * runs rather than merely producing it. It materializes the project into a
 * temporary working directory and runs, in order:
 *
 *   1. **install** — install the project's dependencies.
 *   2. **build**   — type-check / build with the project's own `tsc`.
 *   3. **boot**    — start the server and drive it with a real MCP client,
 *                    asserting `tools/list` matches the planned tool set.
 *   4. **smoke**   — call every tool with a sampled input against a mocked
 *                    upstream and assert each returns a well-formed MCP result.
 *
 * On the first failing stage it sends the error plus the offending file back to
 * the model for a focused repair, applies the patch, and re-runs — up to
 * `maxRepairs` times. The (possibly repaired) file map, a stage-by-stage report,
 * and a full event log are returned; the loop never throws on a verification
 * failure, it reports it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ParseResult, ToolCandidate } from "../ir.js";
import type { GeneratedProject } from "../generate/assemble.js";
import type { LlmClient } from "../generate/llm.js";
import type { Plan } from "../generate/plan.js";
import { emitTelemetry } from "../observability.js";
import { type MockUpstreamFactory, openApiExampleMock } from "./mock.js";
import { type RepairRequest, type StageName, repairFile } from "./repair.js";
import {
  type RepairRecord,
  type StageOutcome,
  renderReport,
} from "./report.js";
import { sampleToolInput } from "./sample.js";
import {
  type DriverCall,
  type DriverOutcome,
  NodeToolchain,
  type Toolchain,
} from "./toolchain.js";

/** A streamed progress event from the loop. */
export type VerifyEvent =
  | { readonly type: "pass-start"; readonly pass: number }
  | { readonly type: "stage-start"; readonly pass: number; readonly stage: StageName }
  | {
      readonly type: "stage-result";
      readonly pass: number;
      readonly stage: StageName;
      readonly ok: boolean;
      readonly detail: string;
      readonly durationMs: number;
    }
  | {
      readonly type: "repair-start";
      readonly pass: number;
      readonly stage: StageName;
      readonly file: string;
    }
  | {
      readonly type: "repair-result";
      readonly pass: number;
      readonly file: string;
      readonly applied: boolean;
      readonly note?: string;
    }
  | {
      readonly type: "done";
      readonly ok: boolean;
      readonly passes: number;
      readonly repairsApplied: number;
    };

/** Options for {@link verifyProject}. */
export interface VerifyOptions {
  /** LLM client used for repairs; omit to verify without self-repair. */
  readonly client?: LlmClient;
  /** Max repair attempts before giving up (default 3). */
  readonly maxRepairs?: number;
  /** Base directory for the temp working copy (default OS temp). */
  readonly workDir?: string;
  /** Toolchain (install/build/run); defaults to the real {@link NodeToolchain}. */
  readonly toolchain?: Toolchain;
  /** Mock-upstream factory; defaults to {@link openApiExampleMock}. */
  readonly mockFactory?: MockUpstreamFactory;
  /** Progress callback for streaming per-stage status. */
  readonly onEvent?: (event: VerifyEvent) => void;
  /** Keep the temp working directory instead of deleting it (debugging). */
  readonly keepWorkDir?: boolean;
}

/** The outcome of a verification run. */
export interface VerifyResult {
  /** Whether every stage passed (after any repairs). */
  readonly ok: boolean;
  /** Number of verification passes run. */
  readonly passes: number;
  /** Number of repair patches applied. */
  readonly repairsApplied: number;
  /** The final project files (with any repairs applied). */
  readonly files: ReadonlyMap<string, string>;
  /** Stage outcomes from the final pass. */
  readonly stages: readonly StageOutcome[];
  /** Rendered `VERIFICATION_REPORT.md` contents. */
  readonly report: string;
  /** Full ordered event log. */
  readonly events: readonly VerifyEvent[];
}

/** Materialize a file map under `root`. */
function writeFiles(root: string, files: Iterable<[string, string]>): void {
  for (const [relativePath, contents] of files) {
    const target = join(root, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
}

/** Locate the first project file referenced by tsc/runtime output, if any. */
function offendingFromOutput(
  output: string,
  files: ReadonlyMap<string, string>,
): string | undefined {
  // tsc: "src/tools/foo.ts(12,3): error TS...".
  const src = output.match(/(src\/[^\s():'"]+\.ts)/);
  if (src && files.has(src[1]!)) return src[1];
  // runtime stack: ".../dist/tools/foo.js:10" → map back to source.
  const dist = output.match(/dist\/([^\s:'"]+)\.js/);
  if (dist) {
    const candidate = `src/${dist[1]}.ts`;
    if (files.has(candidate)) return candidate;
  }
  return undefined;
}

/** Build the per-tool smoke calls from the plan + IR samples. */
function buildCalls(
  plan: Plan,
  candidatesByName: ReadonlyMap<string, ToolCandidate>,
): DriverCall[] {
  return plan.tools.map((planned) => {
    const candidate = candidatesByName.get(planned.sourceName);
    return {
      tool: planned.toolName,
      args: candidate ? sampleToolInput(candidate) : {},
    };
  });
}

/** Evaluate the boot stage from a driver outcome. */
function evalBoot(
  outcome: DriverOutcome,
  expected: readonly string[],
): { ok: boolean; detail: string } {
  if (!outcome.bootOk) {
    return { ok: false, detail: "server failed to boot or list tools" };
  }
  const advertised = new Set(outcome.advertisedTools);
  const missing = expected.filter((t) => !advertised.has(t));
  const extra = outcome.advertisedTools.filter((t) => !expected.includes(t));
  if (missing.length > 0 || extra.length > 0) {
    const parts: string[] = [];
    if (missing.length) parts.push(`missing: ${missing.join(", ")}`);
    if (extra.length) parts.push(`unexpected: ${extra.join(", ")}`);
    return {
      ok: false,
      detail: `advertised tools do not match the plan (${parts.join("; ")})`,
    };
  }
  return {
    ok: true,
    detail: `initialized and advertised ${expected.length} tool(s) matching the plan`,
  };
}

/** Evaluate the smoke stage from a driver outcome. */
function evalSmoke(outcome: DriverOutcome): {
  ok: boolean;
  detail: string;
  failedTool?: string;
} {
  const failed = outcome.toolResults.filter((r) => !r.ok);
  if (failed.length === 0) {
    return {
      ok: true,
      detail: `${outcome.toolResults.length} tool(s) returned a well-formed result`,
    };
  }
  const first = failed[0]!;
  return {
    ok: false,
    detail: `${failed.length} tool(s) failed; e.g. ${first.tool}: ${
      first.message ?? "no result"
    }`,
    failedTool: first.tool,
  };
}

/** Run the verification + self-repair loop over a generated project. */
export async function verifyProject(
  result: ParseResult,
  plan: Plan,
  project: GeneratedProject,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const maxRepairs = options.maxRepairs ?? 3;
  const toolchain = options.toolchain ?? new NodeToolchain();
  const mockFactory = options.mockFactory ?? openApiExampleMock;
  const events: VerifyEvent[] = [];
  const emit = (event: VerifyEvent): void => {
    events.push(event);
    options.onEvent?.(event);
  };

  const candidatesByName = new Map<string, ToolCandidate>(
    result.tools.map((t) => [t.name, t]),
  );
  const expectedTools = plan.tools.map((t) => t.toolName);
  const calls = buildCalls(plan, candidatesByName);

  // Mutable working copy of the project files (repairs mutate this).
  const files = new Map<string, string>(project.files);
  const repairs: RepairRecord[] = [];

  const base = options.workDir ?? tmpdir();
  mkdirSync(base, { recursive: true });
  const workDir = mkdtempSync(join(base, "mcpgen-verify-"));
  writeFiles(workDir, files);

  let ok = false;
  let passes = 0;
  let repairsApplied = 0;
  let finalStages: StageOutcome[] = [];

  /** Run one stage with timing + events. */
  const runStage = async (
    pass: number,
    stage: StageName,
    fn: () => Promise<{ ok: boolean; detail: string; log: string }>,
  ): Promise<StageOutcome> => {
    emit({ type: "stage-start", pass, stage });
    const started = Date.now();
    const { ok: stageOk, detail, log } = await fn();
    const durationMs = Date.now() - started;
    emit({ type: "stage-result", pass, stage, ok: stageOk, detail, durationMs });
    return { stage, ok: stageOk, detail, log, durationMs };
  };

  try {
    let installed = false;
    for (let pass = 1; ; pass += 1) {
      passes = pass;
      emit({ type: "pass-start", pass });
      const stages: StageOutcome[] = [];

      // --- install (first pass only) ---
      if (!installed) {
        const stage = await runStage(pass, "install", async () => {
          const r = await toolchain.install(workDir);
          return {
            ok: r.ok,
            detail: r.ok
              ? "dependencies installed"
              : "dependency installation failed",
            log: r.output,
          };
        });
        stages.push(stage);
        installed = stage.ok;
        if (!stage.ok) {
          // Installation failures are environmental, not LLM-repairable.
          finalStages = stages;
          break;
        }
      }

      // --- build ---
      const buildStage = await runStage(pass, "build", async () => {
        const r = await toolchain.build(workDir);
        return {
          ok: r.ok,
          detail: r.ok ? "type-check / build succeeded" : "build failed",
          log: r.output,
        };
      });
      stages.push(buildStage);

      // --- boot + smoke (only if build succeeded) ---
      // The server is booted and every tool is called in a single driver run
      // (one MCP client session); the spawn + initialize + tools/list cost is
      // attributed to the boot stage, leaving smoke to report the call results.
      let smokeFailedTool: string | undefined;
      if (buildStage.ok) {
        let driverOutcome!: DriverOutcome;
        stages.push(
          await runStage(pass, "boot", async () => {
            const mock = mockFactory(result, plan);
            const upstream = await mock.start();
            try {
              driverOutcome = await toolchain.runDriver(workDir, {
                serverEntry: "dist/server.js",
                env: {
                  MCPGEN_TRANSPORT: "stdio",
                  MCPGEN_API_BASE_URL: upstream.url,
                },
                calls,
              });
            } finally {
              await upstream.close();
            }
            const bootEval = evalBoot(driverOutcome, expectedTools);
            return {
              ok: bootEval.ok,
              detail: bootEval.detail,
              log: driverOutcome.output,
            };
          }),
        );

        if (stages.at(-1)!.ok) {
          const smokeEval = evalSmoke(driverOutcome);
          smokeFailedTool = smokeEval.failedTool;
          stages.push(
            await runStage(pass, "smoke", async () => ({
              ok: smokeEval.ok,
              detail: smokeEval.detail,
              log: driverOutcome.output,
            })),
          );
        }
      }

      finalStages = stages;
      ok = stages.every((s) => s.ok);
      if (ok) break;

      // --- repair the first failing stage ---
      const failing = stages.find((s) => !s.ok)!;
      if (failing.stage === "install") break; // unreachable (handled above), defensive
      if (repairsApplied >= maxRepairs) break; // budget exhausted

      const filePath =
        failing.stage === "smoke" && smokeFailedTool
          ? `src/tools/${smokeFailedTool}.ts`
          : offendingFromOutput(failing.log, files) ?? "src/server.ts";

      if (!options.client) {
        repairs.push({
          iteration: pass,
          stage: failing.stage,
          file: filePath,
          applied: false,
          note: "no LLM client available for repair",
        });
        break;
      }

      emit({ type: "repair-start", pass, stage: failing.stage, file: filePath });
      const fileContent = files.get(filePath);
      if (fileContent === undefined) {
        repairs.push({
          iteration: pass,
          stage: failing.stage,
          file: filePath,
          applied: false,
          note: "could not locate the offending file",
        });
        emit({
          type: "repair-result",
          pass,
          file: filePath,
          applied: false,
          note: "file not found",
        });
        break;
      }

      const request: RepairRequest = {
        stage: failing.stage,
        filePath,
        fileContent,
        errorOutput: failing.log,
      };
      try {
        const patch = await repairFile(options.client, request);
        files.set(patch.path, patch.content);
        writeFiles(workDir, [[patch.path, patch.content]]);
        repairsApplied += 1;
        repairs.push({
          iteration: pass,
          stage: failing.stage,
          file: patch.path,
          applied: true,
        });
        emit({ type: "repair-result", pass, file: patch.path, applied: true });
      } catch (error) {
        repairs.push({
          iteration: pass,
          stage: failing.stage,
          file: filePath,
          applied: false,
          note: `repair failed: ${(error as Error).message}`,
        });
        emit({
          type: "repair-result",
          pass,
          file: filePath,
          applied: false,
          note: (error as Error).message,
        });
        break;
      }
    }
  } finally {
    if (!options.keepWorkDir) {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  emit({ type: "done", ok, passes, repairsApplied });

  // Opt-in, PII-free telemetry (no-op unless MCPGEN_TELEMETRY=1).
  emitTelemetry("verify.complete", {
    ok,
    passes,
    repairsApplied,
    toolCount: plan.tools.length,
  });

  const report = renderReport({
    ok,
    serverName: project.serverName,
    iterations: passes,
    maxRepairs,
    repairs,
    stages: finalStages,
    generatedAt: new Date().toISOString(),
  });

  return { ok, passes, repairsApplied, files, stages: finalStages, report, events };
}
