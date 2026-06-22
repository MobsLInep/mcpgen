/**
 * `mcpgen inspect <source>` — parse an OpenAPI spec, GraphQL schema, or code
 * repo and print a human-readable summary of the tool candidates so a user can
 * eyeball the input before generating anything.
 */
import { resolve } from "node:path";
import {
  type ParseResult,
  type ToolCandidate,
  detectSource,
  isLowConfidence,
} from "@mcpgen/core";
import { renderTable } from "./table.js";

export interface InspectOptions {
  /** Print the raw IR as JSON instead of a table. */
  json?: boolean;
}

/** Describe a tool's operation binding as a compact string. */
function bindingText(tool: ToolCandidate): string {
  const op = tool.operation;
  return op.protocol === "http"
    ? `${op.method} ${op.path}`
    : `${op.operation}:${op.field}`;
}

/** Summarize the auth requirements as a short label. */
function authText(tool: ToolCandidate): string {
  if (tool.auth.length === 0) return "-";
  return tool.auth
    .map((a) => (a.httpScheme ? `${a.scheme}/${a.httpScheme}` : a.scheme))
    .join(",");
}

/** Build the printable report for a parse result. */
export function formatReport(source: string, result: ParseResult): string {
  const { metadata, tools } = result;
  const lines: string[] = [];

  lines.push(`Source:    ${source}`);
  lines.push(`Kind:      ${metadata.kind}`);
  if (metadata.title) lines.push(`Title:     ${metadata.title}`);
  if (metadata.version) lines.push(`Version:   ${metadata.version}`);
  if (metadata.specVersion) lines.push(`Spec:      ${metadata.specVersion}`);
  if (metadata.servers?.length) {
    lines.push(`Servers:   ${metadata.servers.join(", ")}`);
  }
  lines.push(`Tools:     ${metadata.toolCount}`);

  const lowConf = tools.filter(isLowConfidence).length;
  if (lowConf > 0) lines.push(`Low-conf:  ${lowConf} (marked with *)`);
  lines.push("");

  if (tools.length === 0) {
    lines.push("(no tool candidates found)");
  } else {
    const rows = tools.map((t) => [
      isLowConfidence(t) ? `* ${t.name}` : t.name,
      bindingText(t),
      String(t.parameters.length),
      authText(t),
      t.confidence.toFixed(2),
    ]);
    lines.push(
      renderTable(
        ["TOOL", "OPERATION", "PARAMS", "AUTH", "CONF"],
        rows,
        [32, 40, 6, 16, 5],
      ),
    );
  }

  for (const w of metadata.warnings ?? []) lines.push(`\n! ${w}`);
  return lines.join("\n");
}

/** Run the inspect command and return what should be written to stdout. */
export async function runInspect(
  source: string,
  options: InspectOptions = {},
): Promise<string> {
  const absolute = resolve(source);
  const parsed = await (await detectSource(absolute)).parse();
  if (options.json) {
    return JSON.stringify(parsed, null, 2);
  }
  return formatReport(source, parsed);
}
