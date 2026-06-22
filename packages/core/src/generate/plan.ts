/**
 * @fileoverview Stage (a) — planning.
 *
 * Claude proposes the MCP tool set from the IR: a server name and, for each
 * tool candidate it chooses to expose, an MCP-safe tool name, a title, a
 * description, and an optional grouping. The model returns strict JSON which we
 * validate with Zod and cross-check against the IR; malformed or inconsistent
 * output is rejected and retried once before giving up.
 */
import { z } from "zod";
import type { ParseResult } from "../ir.js";
import { sanitizeToolName, uniqueName } from "../ir.js";
import type { LlmClient, LlmMessage } from "./llm.js";

/** One planned tool, after validation. */
export interface PlannedTool {
  /** Name of the source {@link ToolCandidate} this tool maps to. */
  readonly sourceName: string;
  /** MCP-safe tool name to expose. */
  readonly toolName: string;
  /** Short human title. */
  readonly title: string;
  /** Agent-facing description. */
  readonly description: string;
  /** Optional logical group. */
  readonly group?: string;
}

/** The validated output of the plan stage. */
export interface Plan {
  readonly serverName: string;
  readonly serverDescription: string;
  readonly tools: readonly PlannedTool[];
}

const PlanJsonSchema = z.object({
  serverName: z.string().min(1),
  serverDescription: z.string().min(1),
  tools: z
    .array(
      z.object({
        sourceName: z.string().min(1),
        toolName: z.string().min(1),
        title: z.string().min(1),
        description: z.string().min(1),
        group: z.string().optional(),
      }),
    )
    .min(1),
});

/** Raised when the model's plan can't be validated after a retry. */
export class PlanValidationError extends Error {
  constructor(message: string) {
    super(`Plan validation failed: ${message}`);
    this.name = "PlanValidationError";
  }
}

const SYSTEM = `You are mcpgen's planning stage. Given a normalized description of an API (its operations), propose the set of Model Context Protocol (MCP) tools to expose.

Rules:
- Respond with ONLY a single JSON object. No prose, no markdown fences.
- The JSON must match this shape exactly:
  {
    "serverName": string,            // kebab-case, ends with "-mcp"
    "serverDescription": string,
    "tools": [
      {
        "sourceName": string,        // MUST equal one of the provided candidate names
        "toolName": string,          // snake_case, [a-z0-9_], unique
        "title": string,             // short human title
        "description": string,       // what the tool does, for an AI agent
        "group": string              // optional logical grouping
      }
    ]
  }
- Expose every candidate unless it is clearly redundant. Keep sourceName verbatim.`;

/** Build the user message describing the IR for the planner. */
function planUserMessage(result: ParseResult): string {
  const { metadata, tools } = result;
  const lines: string[] = [];
  lines.push(`Source kind: ${metadata.kind}`);
  if (metadata.title) lines.push(`Title: ${metadata.title}`);
  if (metadata.description) lines.push(`Description: ${metadata.description}`);
  if (metadata.version) lines.push(`Version: ${metadata.version}`);
  lines.push("", "Tool candidates:");
  for (const tool of tools) {
    const op =
      tool.operation.protocol === "http"
        ? `${tool.operation.method} ${tool.operation.path}`
        : `${tool.operation.operation}:${tool.operation.field}`;
    const params = tool.parameters
      .map((p) => `${p.name}${p.required ? "" : "?"}:${p.location}`)
      .join(", ");
    lines.push(
      `- name=${tool.name} op=[${op}] params=[${params}] desc=${JSON.stringify(
        tool.description,
      )}`,
    );
  }
  return lines.join("\n");
}

/** Extract the first balanced JSON object from a model response. */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf("{");
  if (start === -1) throw new Error("no JSON object found in response");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i += 1) {
    const ch = body[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced JSON object in response");
}

/** Validate raw model text into a {@link Plan} against the IR. */
function parsePlan(text: string, candidateNames: Set<string>): Plan {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(text));
  } catch (error) {
    throw new PlanValidationError(
      `not valid JSON: ${(error as Error).message}`,
    );
  }
  const parsed = PlanJsonSchema.safeParse(json);
  if (!parsed.success) {
    throw new PlanValidationError(parsed.error.issues[0]?.message ?? "schema");
  }

  const used = new Set<string>();
  const tools: PlannedTool[] = parsed.data.tools.map((t) => {
    if (!candidateNames.has(t.sourceName)) {
      throw new PlanValidationError(
        `sourceName "${t.sourceName}" is not a known tool candidate`,
      );
    }
    const toolName = uniqueName(sanitizeToolName(t.toolName), used);
    return {
      sourceName: t.sourceName,
      toolName,
      title: t.title,
      description: t.description,
      group: t.group,
    };
  });

  return {
    serverName: sanitizeToolName(parsed.data.serverName),
    serverDescription: parsed.data.serverDescription,
    tools,
  };
}

/**
 * Run the plan stage. Calls the model, validates, and retries once with the
 * validation error fed back before failing.
 */
export async function runPlan(
  client: LlmClient,
  result: ParseResult,
): Promise<Plan> {
  const candidateNames = new Set(result.tools.map((t) => t.name));
  const baseMessage = planUserMessage(result);

  const attempt = async (messages: LlmMessage[]): Promise<Plan> => {
    const response = await client.complete({
      tag: "plan",
      system: SYSTEM,
      maxTokens: 4096,
      messages,
    });
    return parsePlan(response.text, candidateNames);
  };

  try {
    return await attempt([{ role: "user", content: baseMessage }]);
  } catch (error) {
    if (!(error instanceof PlanValidationError)) throw error;
    // One corrective retry.
    return attempt([
      { role: "user", content: baseMessage },
      {
        role: "user",
        content: `Your previous response was invalid: ${error.message}. Respond again with ONLY the corrected JSON object.`,
      },
    ]);
  }
}
