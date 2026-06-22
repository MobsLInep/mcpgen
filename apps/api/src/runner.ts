/**
 * @fileoverview The real generation runner: drives `@mcpgen/core` and translates
 * its progress into the web protocol's `JobEvent` stream.
 *
 * Generation itself (`generateProject`) is not event-emitting, so we wrap each
 * coarse phase (parse/plan/synthesize/assemble) in `stage` events for the UI.
 * Verification *is* event-emitting; we forward `verifyProject`'s events. The
 * Anthropic key is read from the server environment only and never leaves it;
 * verification sandboxes in a temp dir that core deletes when it finishes.
 */
import {
  createAnthropicClient,
  generateProject,
  resolveModel,
  verifyProject,
  type LlmClient,
  type StageName,
  type VerifyEvent,
} from "@mcpgen/core";
import type { Job, JobRunner } from "./jobs.js";
import type { JobEvent, JobSummary, StageKey } from "./protocol.js";
import { applyEdits, resolveSource } from "./parse.js";

/** Build the LLM client, or undefined for deterministic generation. */
async function buildClient(useAi: boolean): Promise<{
  client?: LlmClient;
  note: string;
}> {
  if (!useAi) {
    return { note: "deterministic generation (no LLM)" };
  }
  const apiKey =
    process.env.MCPGEN_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      note: "no server API key configured — deterministic generation (no LLM)",
    };
  }
  const model = resolveModel();
  const client = await createAnthropicClient({ apiKey, model });
  return { client, note: `generated with Claude (${model})` };
}

const VERIFY_STAGE: Record<StageName, StageKey> = {
  install: "install",
  build: "build",
  boot: "boot",
  smoke: "smoke",
};

/** Forward a core verification event onto the web protocol stream. */
function forwardVerifyEvent(
  event: VerifyEvent,
  emit: (event: JobEvent) => void,
): void {
  switch (event.type) {
    case "stage-start":
      emit({
        type: "stage",
        group: "verify",
        stage: VERIFY_STAGE[event.stage],
        state: "start",
      });
      break;
    case "stage-result":
      emit({
        type: "stage",
        group: "verify",
        stage: VERIFY_STAGE[event.stage],
        state: event.ok ? "ok" : "fail",
        detail: event.detail,
        durationMs: event.durationMs,
      });
      break;
    case "repair-result":
      emit({
        type: "repair",
        file: event.file,
        applied: event.applied,
        note: event.note,
      });
      break;
    default:
      break;
  }
}

/** The production runner wired into the {@link JobStore}. */
export const realRunner: JobRunner = async (job: Job, emit) => {
  const req = job.request;

  // --- Parse -------------------------------------------------------------
  emit({ type: "phase", phase: "parsing" });
  emit({ type: "stage", group: "generate", stage: "parse", state: "start" });
  const { source, kind } = await resolveSource({
    source: req.source,
    kind: req.kind,
  });
  const parsedRaw = await source.parse();
  const parsed = applyEdits(parsedRaw, req.tools);
  emit({
    type: "stage",
    group: "generate",
    stage: "parse",
    state: "ok",
    detail: `${parsed.tools.length} tool(s) from ${kind} source`,
  });

  if (parsed.tools.length === 0) {
    throw new Error("No tools selected — enable at least one operation.");
  }

  // --- Generate ----------------------------------------------------------
  emit({ type: "phase", phase: "generating" });
  const { client, note } = await buildClient(req.useAi ?? false);

  emit({ type: "stage", group: "generate", stage: "plan", state: "start" });
  emit({
    type: "stage",
    group: "generate",
    stage: "synthesize",
    state: "start",
  });
  const project = await generateProject(parsed, {
    client,
    transport: req.transport,
    auth: req.auth,
  });
  emit({
    type: "stage",
    group: "generate",
    stage: "plan",
    state: "ok",
    detail: project.serverName,
  });
  emit({
    type: "stage",
    group: "generate",
    stage: "synthesize",
    state: "ok",
    detail: `${project.toolCount} tool(s)${project.usedFallback ? " (some fallback)" : ""}`,
  });
  emit({ type: "stage", group: "generate", stage: "assemble", state: "start" });
  emit({
    type: "stage",
    group: "generate",
    stage: "assemble",
    state: "ok",
    detail: `${project.files.size} files`,
  });

  let files = project.files;
  let verification: JobSummary["verification"] = "skipped";

  // --- Verify (optional) -------------------------------------------------
  if (req.verify) {
    emit({ type: "phase", phase: "verifying" });
    const result = await verifyProject(parsed, project.plan, project, {
      client,
      onEvent: (event) => forwardVerifyEvent(event, emit),
    });
    files = result.files;
    verification = {
      ok: result.ok,
      passes: result.passes,
      repairs: result.repairsApplied,
    };
    if (!result.ok) {
      // Surface the report so the user still gets the artifacts to debug.
      files = new Map([
        ...result.files,
        ["VERIFICATION_REPORT.md", result.report],
      ]);
      emit({
        type: "log",
        line: "Verification did not pass — see VERIFICATION_REPORT.md.",
      });
    }
  }

  const summary: JobSummary = {
    serverName: project.serverName,
    toolCount: project.toolCount,
    transport: req.transport,
    usedFallback: project.usedFallback,
    note,
    files: [...files.keys()].sort(),
    verification,
  };

  return { summary, files, serverName: project.serverName };
};
