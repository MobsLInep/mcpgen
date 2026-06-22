/**
 * Presentation helpers for the CLI — color, boxed panels, and friendly error
 * messages. All terminal-only concerns live here so the command modules stay
 * focused on orchestration. picocolors auto-disables color for non-TTY / when
 * `NO_COLOR` is set, so output stays clean when piped or captured in tests.
 */
import pc from "picocolors";

export { pc };

/** Match ANSI SGR escape sequences so we can measure visible width. */
// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g;

/** Visible length of a string, ignoring ANSI color codes. */
function visibleWidth(value: string): number {
  return value.replace(ANSI, "").length;
}

/** Pad a (possibly colored) string to `width` visible columns. */
function padVisible(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - visibleWidth(value)));
}

/**
 * Render a rounded box around `lines` with a `title` in the top border. Lines
 * may contain ANSI color; width is measured against visible characters.
 */
export function panel(title: string, lines: readonly string[]): string {
  const inner = Math.max(
    visibleWidth(title) + 2,
    ...lines.map((l) => visibleWidth(l)),
  );
  const width = inner + 2; // one space of padding each side
  const top = `╭─ ${pc.bold(title)} ${"─".repeat(Math.max(0, width - visibleWidth(title) - 3))}╮`;
  const bottom = `╰${"─".repeat(width)}╯`;
  const body = lines.map((l) => `│ ${padVisible(l, inner)} │`);
  return [top, ...body, bottom].join("\n");
}

const STATUS_ICON = {
  ok: () => pc.green("✔"),
  warn: () => pc.yellow("●"),
  fail: () => pc.red("✘"),
} as const;

/** Colored status glyph for doctor / summary rows. */
export function statusIcon(status: "ok" | "warn" | "fail"): string {
  return STATUS_ICON[status]();
}

/** Data backing the post-generate summary panel. */
export interface SummaryData {
  readonly serverName: string;
  readonly toolCount: number;
  readonly outDir: string;
  readonly note: string;
  readonly usedFallback: boolean;
  /** Verification result, or "skipped" when `--no-verify`. */
  readonly verification:
    | {
        readonly ok: boolean;
        readonly passes: number;
        readonly repairs: number;
      }
    | "skipped";
}

/** The summary as individual rows (no surrounding box). */
export function summaryRows(data: SummaryData): string[] {
  const verifyLine =
    data.verification === "skipped"
      ? `${pc.yellow("●")} verification skipped`
      : data.verification.ok
        ? `${statusIcon("ok")} verified — installed, built, booted & smoke-tested ` +
          `(${data.verification.passes} pass(es), ${data.verification.repairs} repair(s))`
        : `${statusIcon("fail")} verification failed — see VERIFICATION_REPORT.md`;

  const rows = [
    `${pc.dim("server  ")} ${pc.bold(data.serverName)}`,
    `${pc.dim("tools   ")} ${data.toolCount}`,
    `${pc.dim("output  ")} ${data.outDir}`,
    `${pc.dim("engine  ")} ${data.note}`,
    verifyLine,
  ];
  if (data.usedFallback) {
    rows.push(
      `${pc.yellow("●")} some tools used deterministic fallback — review SECURITY.md`,
    );
  }
  return rows;
}

/** Render the final summary as a bordered panel (for the `generate` command). */
export function summaryPanel(data: SummaryData): string {
  return panel("mcpgen · generated", summaryRows(data));
}

/** Render a copy-paste "next steps" block. */
export function nextSteps(outDir: string, transport: "stdio" | "http"): string {
  const run =
    transport === "http"
      ? "MCPGEN_TRANSPORT=http node dist/server.js"
      : "MCPGEN_TRANSPORT=stdio node dist/server.js";
  const cmds = [`cd ${outDir}`, "npm install && npm run build", run];
  return [
    ...cmds.map((c) => `${pc.cyan("$")} ${c}`),
    "",
    `${pc.dim("→ See README.md to connect Claude Desktop, Cursor, or VS Code.")}`,
  ].join("\n");
}

/** A friendly, actionable rendering of an error. */
export interface FriendlyError {
  readonly message: string;
  readonly fix?: string;
}

/**
 * Map a thrown error to a non-cryptic message plus a suggested fix. Recognizes
 * the typed errors core exports (by `name`, robust across module boundaries)
 * and common filesystem failures.
 */
export function friendlyError(error: unknown): FriendlyError {
  const err = error as { name?: string; code?: string; message?: string };
  const message = err?.message ?? String(error);
  const name = err?.name;

  if (err?.code === "ENOENT" || /ENOENT|no such file/i.test(message)) {
    return {
      message: "source not found on disk",
      fix: "check the path — pass an OpenAPI spec, GraphQL schema, or a code directory. Run `mcpgen inspect <source>` to preview it first.",
    };
  }
  switch (name) {
    case "UnknownSourceError":
      return {
        message,
        fix: "mcpgen accepts an OpenAPI 3.x spec (.json/.yaml), a GraphQL schema (.graphql/SDL or introspection JSON), or a directory containing an Express/Fastify app.",
      };
    case "OpenApiValidationError":
      return {
        message: `the OpenAPI spec is invalid: ${message}`,
        fix: "validate it (e.g. https://editor.swagger.io) and fix the reported path, then retry.",
      };
    case "MissingApiKeyError":
      return {
        message: "no Anthropic API key configured",
        fix: "export ANTHROPIC_API_KEY=sk-ant-… for LLM generation, or pass --offline for deterministic generation. Run `mcpgen doctor` to check your environment.",
      };
    case "PlanValidationError":
      return {
        message: `the model returned an invalid plan: ${message}`,
        fix: "retry — this is usually transient. If it persists, try --offline or a different --model.",
      };
    default:
      return { message };
  }
}

/** Print a friendly error block to stderr. */
export function printError(command: string, error: unknown): void {
  const { message, fix } = friendlyError(error);
  process.stderr.write(
    `\n${pc.red(pc.bold(`✘ mcpgen ${command}:`))} ${message}\n`,
  );
  if (fix) process.stderr.write(`${pc.dim("  fix:")} ${fix}\n`);
}
