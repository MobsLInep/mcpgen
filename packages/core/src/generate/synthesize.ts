/**
 * @fileoverview Stage (b) — per-tool synthesis.
 *
 * For each planned tool we need two pieces of generated source: the Zod input
 * shape (the object literal passed to `registerTool`, which validates input)
 * and the handler body (the statements that call the upstream operation through
 * the safe `ctx.http` client and return an MCP result).
 *
 * The primary path asks Claude for both, validates the JSON with Zod, and
 * retries once. To keep generation robust and always-compilable, a fully
 * deterministic {@link fallbackSynthesize} derives both directly from the IR;
 * it is used when no LLM is available or when the model output stays invalid.
 */
import { z } from "zod";
import type { ParameterCandidate, ToolCandidate } from "../ir.js";
import type { LlmClient, LlmMessage } from "./llm.js";
import { extractJson } from "./plan.js";
import type { PlannedTool } from "./plan.js";
import { jsonSchemaToZod, propertyKey } from "./zodgen.js";

/** Generated source for one tool. */
export interface ToolCode {
  /** Zod raw-shape object literal, e.g. `{ limit: z.number().int().optional() }`. */
  readonly inputShape: string;
  /** Handler statements (must `return` an MCP result, using `ctx.http`). */
  readonly handlerBody: string;
  /** Whether this came from the deterministic fallback rather than the LLM. */
  readonly fallback: boolean;
}

const ToolCodeJsonSchema = z.object({
  inputShape: z.string().min(1),
  handlerBody: z.string().min(1),
});

const SYSTEM = `You are mcpgen's synthesis stage. For ONE tool, produce the TypeScript source for its Zod input shape and its handler body.

Respond with ONLY a single JSON object (no prose, no markdown fences):
  { "inputShape": string, "handlerBody": string }

Contract:
- "inputShape" is an OBJECT LITERAL that is a Zod raw shape — the value assigned in \`const inputSchema = <inputShape>;\` and passed to MCP \`registerTool\`. Example: { limit: z.number().int().optional(), tags: z.array(z.string()).optional() }. It MUST start with "{" and end with "}". Use only the \`z\` import. For no parameters use {}.
- "handlerBody" is the body of \`async function handler(args, ctx): Promise<ToolResult>\`. It MUST call the upstream operation through \`ctx.http.request({...})\` and MUST \`return\` an object of the form { content: [{ type: "text", text: ... }], isError?: boolean }.
- NEVER build URLs by string concatenation. Pass method/path/pathParams/query/body to ctx.http.request; the client encodes them safely.
- Read inputs from \`args\` (already validated against inputSchema). Do not re-validate.`;

/** Map a parameter's JSON Schema to a raw-shape entry (`key: zodExpr`). */
function shapeEntry(param: ParameterCandidate): string {
  let expr = jsonSchemaToZod(param.schema);
  if (param.description) {
    expr += `.describe(${JSON.stringify(param.description)})`;
  }
  if (!param.required) expr += ".optional()";
  return `${propertyKey(param.name)}: ${expr}`;
}

/** Build the deterministic Zod raw-shape literal for a candidate. */
export function buildInputShape(candidate: ToolCandidate): string {
  if (candidate.parameters.length === 0) return "{}";
  const entries = candidate.parameters.map((p) => `  ${shapeEntry(p)},`);
  return `{\n${entries.join("\n")}\n}`;
}

function argRef(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
    ? `args.${name}`
    : `args[${JSON.stringify(name)}]`;
}

/** Build the deterministic handler body for a candidate. */
export function buildHandlerBody(candidate: ToolCandidate): string {
  const op = candidate.operation;
  const lines: string[] = [];

  if (op.protocol === "http") {
    const byLocation = (loc: string) =>
      candidate.parameters.filter((p) => p.location === loc);
    const pathParams = byLocation("path");
    const queryParams = [...byLocation("query"), ...byLocation("arg")];
    const headerParams = byLocation("header");
    const bodyParam = candidate.parameters.find((p) => p.location === "body");

    lines.push("  const res = await ctx.http.request({");
    lines.push(`    method: ${JSON.stringify(op.method)},`);
    lines.push(`    path: ${JSON.stringify(op.path)},`);
    if (pathParams.length > 0) {
      const entries = pathParams
        .map((p) => `${propertyKey(p.name)}: ${argRef(p.name)}`)
        .join(", ");
      lines.push(`    pathParams: { ${entries} },`);
    }
    if (queryParams.length > 0) {
      const entries = queryParams
        .map((p) => `${propertyKey(p.name)}: ${argRef(p.name)}`)
        .join(", ");
      lines.push(`    query: { ${entries} },`);
    }
    if (headerParams.length > 0) {
      const entries = headerParams
        .map((p) => `${propertyKey(p.name)}: String(${argRef(p.name)})`)
        .join(", ");
      lines.push(`    headers: { ${entries} },`);
    }
    if (bodyParam) {
      lines.push(`    body: ${argRef(bodyParam.name)},`);
    }
    lines.push("  });");
  } else {
    // GraphQL: best-effort POST of the operation as a query with variables.
    const varEntries = candidate.parameters
      .map((p) => `${propertyKey(p.name)}: ${argRef(p.name)}`)
      .join(", ");
    lines.push("  // GraphQL operation — review this query before deploying.");
    lines.push("  const res = await ctx.http.request({");
    lines.push('    method: "POST",');
    lines.push('    path: "",');
    lines.push("    body: {");
    lines.push(
      `      query: ${JSON.stringify(
        `${op.operation} { ${op.field} }`,
      )},`,
    );
    lines.push(`      variables: { ${varEntries} },`);
    lines.push("    },");
    lines.push("  });");
  }

  lines.push("  return {");
  lines.push(
    "    content: [{ type: \"text\", text: JSON.stringify(res.data, null, 2) }],",
  );
  lines.push("    isError: res.status >= 400,");
  lines.push("  };");
  return lines.join("\n");
}

/** Produce tool code deterministically from the IR (no LLM). */
export function fallbackSynthesize(candidate: ToolCandidate): ToolCode {
  return {
    inputShape: buildInputShape(candidate),
    handlerBody: buildHandlerBody(candidate),
    fallback: true,
  };
}

/** Validate raw model text into {@link ToolCode}; throws on malformed output. */
function parseToolCode(text: string): ToolCode {
  const json = JSON.parse(extractJson(text));
  const parsed = ToolCodeJsonSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "schema mismatch");
  }
  const inputShape = parsed.data.inputShape.trim();
  const handlerBody = parsed.data.handlerBody;
  if (!inputShape.startsWith("{") || !inputShape.endsWith("}")) {
    throw new Error("inputShape is not an object literal");
  }
  if (!/\breturn\b/.test(handlerBody) || !handlerBody.includes("ctx.http")) {
    throw new Error("handlerBody must call ctx.http and return a result");
  }
  return { inputShape, handlerBody, fallback: false };
}

/** Build the synthesis prompt for one planned tool. */
function synthUserMessage(
  candidate: ToolCandidate,
  planned: PlannedTool,
): string {
  const op =
    candidate.operation.protocol === "http"
      ? `${candidate.operation.method} ${candidate.operation.path}`
      : `${candidate.operation.operation}:${candidate.operation.field}`;
  return [
    `Tool name: ${planned.toolName}`,
    `Title: ${planned.title}`,
    `Description: ${planned.description}`,
    `Upstream operation: ${op}`,
    "",
    "Parameters (name, location, required, JSON Schema):",
    ...candidate.parameters.map(
      (p) =>
        `- ${p.name} [${p.location}] ${p.required ? "required" : "optional"}: ${JSON.stringify(
          p.schema,
        )}`,
    ),
    "",
    `Suggested Zod input shape (you may refine it): ${buildInputShape(candidate)}`,
  ].join("\n");
}

/**
 * Synthesize one tool's code. Tries the LLM (validated, one retry); on any
 * failure — including no client — returns the deterministic fallback so
 * generation never hard-fails.
 */
export async function synthesizeTool(
  client: LlmClient | undefined,
  candidate: ToolCandidate,
  planned: PlannedTool,
): Promise<ToolCode> {
  if (!client) return fallbackSynthesize(candidate);

  const baseMessage = synthUserMessage(candidate, planned);
  const attempt = async (messages: LlmMessage[]): Promise<ToolCode> => {
    const response = await client.complete({
      tag: `tool.${candidate.name}`,
      system: SYSTEM,
      maxTokens: 4096,
      messages,
    });
    return parseToolCode(response.text);
  };

  try {
    return await attempt([{ role: "user", content: baseMessage }]);
  } catch {
    try {
      return await attempt([
        { role: "user", content: baseMessage },
        {
          role: "user",
          content:
            "Your previous response was invalid. Respond again with ONLY the corrected JSON object matching the contract.",
        },
      ]);
    } catch {
      return fallbackSynthesize(candidate);
    }
  }
}
