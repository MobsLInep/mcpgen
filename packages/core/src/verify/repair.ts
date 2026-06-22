/**
 * @fileoverview The repair stage.
 *
 * When a verification stage fails, the loop sends Claude a focused prompt — the
 * failing stage, the captured error output, and the full current contents of the
 * single offending file — and asks for a corrected version of *that file only*.
 * The model returns strict JSON (`{ path, content }`) which we validate before
 * applying. Keeping repairs file-scoped makes patches easy to apply and review
 * and stops one failure from rewriting the whole project.
 */
import { z } from "zod";
import type { LlmClient } from "../generate/llm.js";
import { extractJson } from "../generate/plan.js";

/** Which stage produced the failure being repaired. */
export type StageName = "install" | "build" | "boot" | "smoke";

/** A focused repair request for one file. */
export interface RepairRequest {
  /** The stage that failed. */
  readonly stage: StageName;
  /** Project-relative path of the offending file. */
  readonly filePath: string;
  /** Current full contents of that file. */
  readonly fileContent: string;
  /** Captured error output (tsc diagnostics, server stderr, etc.). */
  readonly errorOutput: string;
}

/** A validated repair: the file to overwrite and its new full contents. */
export interface RepairPatch {
  readonly path: string;
  readonly content: string;
}

const RepairJsonSchema = z.object({
  path: z.string().min(1),
  content: z.string().min(1),
});

const SYSTEM = `You are mcpgen's repair stage. A single file in a generated, typed MCP server (TypeScript, ESM, MCP SDK v1.x, Zod) failed verification. Fix ONLY the reported problem in that ONE file.

Respond with ONLY a single JSON object (no prose, no markdown fences):
  { "path": string, "content": string }

Rules:
- "path" MUST equal the path of the file you were given.
- "content" MUST be the COMPLETE corrected file (not a diff, not a fragment).
- Preserve the file's structure, exports, and imports; change only what is needed to fix the failure.
- Do not introduce new dependencies. Tool handlers must keep calling the upstream through ctx.http.request and returning { content: [...], isError? }.`;

/** Cap on how much error/log text we feed the model. */
const MAX_ERROR_CHARS = 6000;

/** Build the user message describing the failure. */
function userMessage(request: RepairRequest): string {
  const error =
    request.errorOutput.length > MAX_ERROR_CHARS
      ? `${request.errorOutput.slice(-MAX_ERROR_CHARS)}\n[...truncated...]`
      : request.errorOutput;
  return [
    `The "${request.stage}" stage failed.`,
    "",
    "Error output:",
    "```",
    error.trim() || "(no output captured)",
    "```",
    "",
    `Offending file: ${request.filePath}`,
    "```typescript",
    request.fileContent,
    "```",
    "",
    "Return the corrected file as the JSON object described in the system prompt.",
  ].join("\n");
}

/** Parse + validate the model's repair into a {@link RepairPatch}. */
function parsePatch(text: string, expectedPath: string): RepairPatch {
  const parsed = RepairJsonSchema.safeParse(JSON.parse(extractJson(text)));
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "schema mismatch");
  }
  // Trust our own path over the model's, but require non-empty content.
  return { path: expectedPath, content: parsed.data.content };
}

/**
 * Ask the model to repair one file. The request {@link LlmClient.complete} tag is
 * `repair:<path>` so recorded-fixture clients can route to a recorded patch.
 * Throws if the model output can't be validated.
 */
export async function repairFile(
  client: LlmClient,
  request: RepairRequest,
): Promise<RepairPatch> {
  const response = await client.complete({
    tag: `repair:${request.filePath}`,
    system: SYSTEM,
    maxTokens: 8192,
    messages: [{ role: "user", content: userMessage(request) }],
  });
  return parsePatch(response.text, request.filePath);
}
