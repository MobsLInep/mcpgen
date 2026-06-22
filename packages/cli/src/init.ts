/**
 * `mcpgen init` — a guided wizard that collects a source, transport, auth, and
 * output directory, then runs generation with live progress. The wizard is a
 * thin front end over {@link runGenerate}; all real work happens in core.
 */
import { existsSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import * as p from "@clack/prompts";
import { ANTHROPIC_KEY_VARS } from "@mcpgen/core";
import {
  type AuthMode,
  type GenerateSummary,
  runGenerate,
} from "./generate.js";
import { nextSteps, pc, summaryRows } from "./ui.js";

/** Suggest a project directory name from the source path. */
function suggestOutDir(source: string): string {
  const base = basename(source, extname(source)).replace(
    /[^a-zA-Z0-9._-]+/g,
    "-",
  );
  const name = base && base !== "." ? base : "mcp-server";
  return `./${name}-mcp`;
}

/** True when an Anthropic API key is present in the environment. */
function hasApiKey(): boolean {
  return ANTHROPIC_KEY_VARS.some((name) => {
    const value = process.env[name];
    return typeof value === "string" && value.length > 0;
  });
}

/** Strip leading whitespace/newlines so a log line fits a spinner update. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Run the interactive wizard. Returns the process exit code. */
export async function runInit(): Promise<number> {
  p.intro(`${pc.bgCyan(pc.black(" mcpgen "))} ${pc.dim("guided setup")}`);

  const source = await p.text({
    message: "Where is your API source?",
    placeholder: "./openapi.yaml, ./schema.graphql, or ./my-service",
    validate: (value) => {
      if (!value) return "Please enter a path.";
      if (!existsSync(resolve(value))) return `Nothing found at "${value}".`;
      return undefined;
    },
  });
  if (p.isCancel(source)) return cancel();

  const transport = await p.select({
    message: "Which transport should the server use?",
    options: [
      {
        value: "stdio",
        label: "stdio",
        hint: "local — Claude Desktop, Cursor, VS Code launch it",
      },
      {
        value: "http",
        label: "http",
        hint: "remote — Streamable HTTP, deploy as a service",
      },
    ],
    initialValue: "stdio",
  });
  if (p.isCancel(transport)) return cancel();

  const auth = await p.select({
    message: "How should upstream auth be handled?",
    options: [
      { value: "", label: "Derive from the source", hint: "recommended" },
      {
        value: "apikey",
        label: "API key",
        hint: "send a key from the environment",
      },
      { value: "none", label: "None", hint: "the API is public" },
      { value: "oauth", label: "OAuth", hint: "scaffold OAuth handling" },
    ],
    initialValue: "",
  });
  if (p.isCancel(auth)) return cancel();

  const out = await p.text({
    message: "Where should the generated server go?",
    initialValue: suggestOutDir(String(source)),
    validate: (value) => (value ? undefined : "Please enter a directory."),
  });
  if (p.isCancel(out)) return cancel();

  const verify = await p.confirm({
    message: "Verify the server actually runs after generating?",
    initialValue: true,
  });
  if (p.isCancel(verify)) return cancel();

  // Tell the user up front whether we'll use the LLM or offline synthesis.
  const offline = !hasApiKey();
  if (offline) {
    p.log.warn(
      `No Anthropic API key found — using deterministic (offline) generation.\n` +
        `Set ${pc.bold("ANTHROPIC_API_KEY")} for higher-fidelity output.`,
    );
  } else {
    p.log.info("Anthropic API key detected — using LLM-powered generation.");
  }

  const s = p.spinner();
  s.start("Generating MCP server…");

  let result: { ok: boolean; summary: GenerateSummary };
  try {
    result = await runGenerate(resolve(String(source)), {
      out: String(out),
      transport: transport as "stdio" | "http",
      auth: (auth as string) ? (auth as AuthMode) : undefined,
      offline,
      verify: verify as boolean,
      log: (line) => {
        const text = oneLine(line);
        if (text) s.message(text);
      },
    });
  } catch (error) {
    s.stop(pc.red("Generation failed."));
    const message = error instanceof Error ? error.message : String(error);
    p.cancel(message);
    return 1;
  }

  s.stop("Generation complete.");

  // Final summary + copy-paste next steps (clack draws the box).
  p.note(
    summaryRows({
      serverName: result.summary.serverName,
      toolCount: result.summary.toolCount,
      outDir: result.summary.outDir,
      note: result.summary.note,
      usedFallback: result.summary.usedFallback,
      verification: result.summary.verification,
    }).join("\n"),
    "Summary",
  );
  p.note(
    nextSteps(result.summary.outDir, result.summary.transport),
    "Next steps",
  );

  if (result.ok) {
    p.outro(pc.green("Your MCP server is ready. 🎉"));
    return 0;
  }
  p.outro(
    pc.yellow(
      `Generated, but verification did not pass — see ${result.summary.reportPath ?? "VERIFICATION_REPORT.md"}.`,
    ),
  );
  return 1;
}

/** Common cancel handler. */
function cancel(): number {
  p.cancel("Setup cancelled.");
  return 1;
}
