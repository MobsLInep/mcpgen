/**
 * @fileoverview Stage (c) — assembly.
 *
 * Combines the {@link Plan}, the per-tool {@link ToolCode}, and the fixed
 * template files from `@mcpgen/templates` into a complete project: a map of
 * relative path → file contents. No I/O happens here — writing to disk is a
 * separate concern (see `engine.ts`) so assembly stays pure and testable.
 */
import { renderTemplate } from "@mcpgen/templates";
import type { AuthRequirement, ParseResult, ToolCandidate } from "../ir.js";
import { sanitizeToolName } from "../ir.js";
import type { Plan, PlannedTool } from "./plan.js";
import type { ToolCode } from "./synthesize.js";

/** Pinned dependency versions for generated projects. */
const SDK_VERSION = "^1.21.0";
const ZOD_VERSION = "^3.25.0";
const EXPRESS_VERSION = "^5.1.0";

/** Auth handling requested at the CLI. */
export type AuthMode = "apikey" | "oauth" | "none";

/** Options that steer assembly. */
export interface AssembleOptions {
  readonly transport: "stdio" | "http";
  /** Override the IR-derived auth handling; omit to derive from the source. */
  readonly auth?: AuthMode;
}

/** A fully assembled, ready-to-write project. */
export interface GeneratedProject {
  /** Relative path → file contents. */
  readonly files: ReadonlyMap<string, string>;
  /** Generated server name. */
  readonly serverName: string;
  /** Number of tools registered. */
  readonly toolCount: number;
  /** Whether any tool fell back to deterministic synthesis. */
  readonly usedFallback: boolean;
  /**
   * The plan this project was assembled from. Carried on the result so the
   * verification loop can derive expected tool names + smoke inputs without
   * re-running the (non-deterministic) planner.
   */
  readonly plan: Plan;
}

/** A credential scheme emitted into the generated `config.ts`. */
interface AuthScheme {
  kind: "apiKey" | "bearer" | "basic";
  in?: "header" | "query";
  name?: string;
  envVar: string;
  /** Human note for docs (not emitted into config). */
  note: string;
}

/** Derive an env var name from an apiKey header/query parameter name. */
function envVarFromName(name: string): string {
  const upper = name.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
  return `MCPGEN_${upper}`.replace(/_+/g, "_").replace(/_$/, "");
}

/** Translate one IR auth requirement into a generated auth scheme. */
function schemeFromRequirement(req: AuthRequirement): AuthScheme | undefined {
  switch (req.scheme) {
    case "apiKey": {
      const name = req.name ?? "X-API-Key";
      const location = req.location === "query" ? "query" : "header";
      return {
        kind: "apiKey",
        in: location,
        name,
        envVar: envVarFromName(name),
        note: `API key sent as the \`${name}\` ${location}.`,
      };
    }
    case "http":
      if (req.httpScheme === "basic") {
        return {
          kind: "basic",
          envVar: "MCPGEN_BASIC_AUTH",
          note: "HTTP Basic credentials (base64 of `user:pass`).",
        };
      }
      return {
        kind: "bearer",
        envVar: "MCPGEN_BEARER_TOKEN",
        note: "HTTP bearer token.",
      };
    case "oauth2":
    case "openIdConnect":
      return {
        kind: "bearer",
        envVar: "MCPGEN_BEARER_TOKEN",
        note: "OAuth2 / OIDC access token, sent as a bearer token.",
      };
    default:
      return undefined;
  }
}

/** Collect the distinct auth schemes for the project, honoring the CLI override. */
function deriveAuthSchemes(
  result: ParseResult,
  auth: AuthMode | undefined,
): AuthScheme[] {
  if (auth === "none") return [];

  if (auth === "oauth") {
    return [
      {
        kind: "bearer",
        envVar: "MCPGEN_BEARER_TOKEN",
        note: "OAuth2 / OIDC access token, sent as a bearer token.",
      },
    ];
  }

  const schemes = new Map<string, AuthScheme>();
  for (const tool of result.tools) {
    for (const req of tool.auth) {
      const scheme = schemeFromRequirement(req);
      if (scheme) {
        const key = `${scheme.kind}:${scheme.in ?? ""}:${scheme.name ?? ""}`;
        if (!schemes.has(key)) schemes.set(key, scheme);
      }
    }
  }

  if (auth === "apikey" && schemes.size === 0) {
    schemes.set("apiKey:header:X-API-Key", {
      kind: "apiKey",
      in: "header",
      name: "X-API-Key",
      envVar: "MCPGEN_API_KEY",
      note: "API key sent as the `X-API-Key` header.",
    });
  }

  return [...schemes.values()];
}

/** A JS-string literal that is safe to embed in generated source. */
function literal(value: string): string {
  return JSON.stringify(value);
}

/** A safe, unique TS import alias for a tool. */
function importAlias(index: number): string {
  return `t${index}`;
}

/** Render the per-tool source file. */
function renderToolFile(
  planned: PlannedTool,
  candidate: ToolCandidate,
  code: ToolCode,
): string {
  const op =
    candidate.operation.protocol === "http"
      ? `${candidate.operation.method} ${candidate.operation.path}`
      : `${candidate.operation.operation}:${candidate.operation.field}`;
  return renderTemplate("tool.ts.tmpl", {
    TOOL_NAME: planned.toolName,
    TOOL_NAME_LITERAL: literal(planned.toolName),
    TOOL_TITLE_LITERAL: literal(planned.title),
    TOOL_DESCRIPTION_LITERAL: literal(planned.description),
    INPUT_SHAPE: code.inputShape,
    HANDLER_BODY: code.handlerBody,
    PROVENANCE: op,
  });
}

/** Assemble the full project from the plan and synthesized tool code. */
export function assembleProject(
  result: ParseResult,
  plan: Plan,
  toolCode: readonly ToolCode[],
  candidatesByName: ReadonlyMap<string, ToolCandidate>,
  options: AssembleOptions,
): GeneratedProject {
  const files = new Map<string, string>();
  const serverName = plan.serverName || "mcp-server";
  const packageName = sanitizeToolName(serverName).toLowerCase() || "mcp-server";
  const version = result.metadata.version ?? "0.1.0";
  const baseUrl = result.metadata.servers?.[0] ?? "";
  const schemes = deriveAuthSchemes(result, options.auth);

  // --- Per-tool files + registry ---
  const importLines: string[] = [];
  const arrayLines: string[] = [];
  let usedFallback = false;

  plan.tools.forEach((planned, index) => {
    const candidate = candidatesByName.get(planned.sourceName);
    if (!candidate) return;
    const code = toolCode[index]!;
    if (code.fallback) usedFallback = true;
    files.set(
      `src/tools/${planned.toolName}.ts`,
      renderToolFile(planned, candidate, code),
    );
    const alias = importAlias(index);
    importLines.push(
      `import { tool as ${alias} } from "./${planned.toolName}.js";`,
    );
    arrayLines.push(`  ${alias},`);
  });

  files.set(
    "src/tools/index.ts",
    renderTemplate("tools-index.ts.tmpl", {
      TOOL_IMPORTS: importLines.join("\n"),
      TOOL_ARRAY: arrayLines.join("\n"),
    }),
  );

  // --- Fixed source files ---
  files.set("src/runtime.ts", renderTemplate("runtime.ts.tmpl", {}));
  files.set("src/http.ts", renderTemplate("http.ts.tmpl", {}));
  files.set(
    "src/config.ts",
    renderTemplate("config.ts.tmpl", {
      AUTH_SCHEMES: authSchemesLiteral(schemes),
      DEFAULT_TRANSPORT: options.transport,
      API_BASE_URL: baseUrl,
    }),
  );
  files.set(
    "src/server.ts",
    renderTemplate("server.ts.tmpl", {
      SERVER_NAME: packageName,
      SERVER_VERSION: version,
    }),
  );

  // --- Project metadata + docs ---
  files.set(
    "package.json",
    renderTemplate("package.json.tmpl", {
      PACKAGE_NAME: packageName,
      SERVER_VERSION: version,
      DESCRIPTION: plan.serverDescription,
      SDK_VERSION,
      ZOD_VERSION,
      EXPRESS_VERSION,
    }),
  );
  files.set("tsconfig.json", renderTemplate("tsconfig.json.tmpl", {}));
  files.set("Dockerfile", renderTemplate("Dockerfile.tmpl", {}));
  files.set(".gitignore", renderTemplate("gitignore.tmpl", {}));
  files.set(
    ".env.example",
    renderTemplate("env.example.tmpl", {
      SERVER_NAME: packageName,
      API_BASE_URL: baseUrl,
      DEFAULT_TRANSPORT: options.transport,
      ENV_VARS: envVarsDoc(schemes),
    }),
  );
  files.set(
    "README.md",
    renderTemplate("README.md.tmpl", {
      SERVER_NAME: packageName,
      PACKAGE_NAME: packageName,
      DESCRIPTION: plan.serverDescription,
      SOURCE_KIND: result.metadata.kind,
      API_BASE_URL: baseUrl,
      TOOL_LIST: toolListDoc(plan),
      CONNECT_SECTION: connectSectionDoc(packageName, options.transport, schemes),
    }),
  );
  files.set(
    "SECURITY.md",
    renderTemplate("SECURITY.md.tmpl", {
      SERVER_NAME: packageName,
      REVIEW_LIST: reviewListDoc(plan, candidatesByName, usedFallback),
      AUTH_NOTES: authNotesDoc(schemes),
    }),
  );

  return {
    files,
    serverName: packageName,
    toolCount: plan.tools.length,
    usedFallback,
    plan,
  };
}

/** Emit the `AuthScheme[]` literal for `config.ts` (config fields only). */
function authSchemesLiteral(schemes: AuthScheme[]): string {
  const objects = schemes.map((s) => {
    const fields = [`kind: ${literal(s.kind)}`];
    if (s.in) fields.push(`in: ${literal(s.in)}`);
    if (s.name) fields.push(`name: ${literal(s.name)}`);
    fields.push(`envVar: ${literal(s.envVar)}`);
    return `  { ${fields.join(", ")} }`;
  });
  return objects.length === 0 ? "[]" : `[\n${objects.join(",\n")},\n]`;
}

/** Render the `.env.example` credentials section. */
function envVarsDoc(schemes: AuthScheme[]): string {
  if (schemes.length === 0) {
    return "# (the source declares no authentication)";
  }
  return schemes.map((s) => `# ${s.note}\n${s.envVar}=`).join("\n");
}

/** Render the README tool list. */
function toolListDoc(plan: Plan): string {
  return plan.tools
    .map((t) => `- **${t.toolName}** — ${t.description}`)
    .join("\n");
}

/**
 * Render the README "connect to an AI client" section: ready-to-paste MCP
 * client config for Claude Desktop, Cursor, and VS Code. The shape depends on
 * the transport — stdio clients launch `node dist/server.js`; http clients
 * point at the Streamable HTTP URL.
 */
function connectSectionDoc(
  packageName: string,
  transport: "stdio" | "http",
  schemes: AuthScheme[],
): string {
  const serverPath = `/ABSOLUTE/PATH/TO/${packageName}/dist/server.js`;
  const env: Record<string, string> = {};
  for (const scheme of schemes) env[scheme.envVar] = "<your-credential>";

  // The server entry under each of the three clients' config keys.
  const entry =
    transport === "http"
      ? {
          type: "http",
          url: "http://localhost:3000/mcp",
          ...(Object.keys(env).length > 0 ? { env } : {}),
        }
      : {
          command: "node",
          args: [serverPath],
          ...(Object.keys(env).length > 0 ? { env } : {}),
        };

  const desktop = JSON.stringify(
    { mcpServers: { [packageName]: entry } },
    null,
    2,
  );
  const vscode = JSON.stringify({ servers: { [packageName]: entry } }, null, 2);

  const startNote =
    transport === "http"
      ? "Start the server first with `MCPGEN_TRANSPORT=http node dist/server.js`, then add:"
      : "These clients launch the server for you over stdio — no need to start it yourself.";

  const lines = [
    startNote,
    "",
    "**Claude Desktop** — add to `claude_desktop_config.json` (Settings → Developer → Edit Config):",
    "",
    "```json",
    desktop,
    "```",
    "",
    "**Cursor** — add to `.cursor/mcp.json` in your project (or the global `~/.cursor/mcp.json`):",
    "",
    "```json",
    desktop,
    "```",
    "",
    "**VS Code** — add to `.vscode/mcp.json` (note the `servers` key):",
    "",
    "```json",
    vscode,
    "```",
  ];
  if (schemes.length > 0) {
    lines.push(
      "",
      "Replace `<your-credential>` with a real value, or drop the `env` block and" +
        " supply credentials via `.env` / your shell instead.",
    );
  }
  return lines.join("\n");
}

/** Render the SECURITY.md operator review checklist. */
function reviewListDoc(
  plan: Plan,
  candidatesByName: ReadonlyMap<string, ToolCandidate>,
  usedFallback: boolean,
): string {
  const lines = plan.tools.map((t) => {
    const candidate = candidatesByName.get(t.sourceName);
    const op = candidate
      ? candidate.operation.protocol === "http"
        ? `${candidate.operation.method} ${candidate.operation.path}`
        : `${candidate.operation.operation}:${candidate.operation.field}`
      : "unknown";
    return `- \`${t.toolName}\` → \`${op}\`: confirm the handler maps inputs to the intended upstream call and exposes no more than required.`;
  });
  if (usedFallback) {
    lines.push(
      "- Some handlers used the deterministic fallback synthesizer; review their request shaping especially carefully.",
    );
  }
  return lines.join("\n");
}

/** Render the SECURITY.md authentication notes. */
function authNotesDoc(schemes: AuthScheme[]): string {
  if (schemes.length === 0) {
    return "The source declares no authentication. If the upstream API in fact requires credentials, add a scheme and the corresponding environment variable before deploying.";
  }
  return [
    "The following credentials are read from the environment and attached to every upstream request:",
    "",
    ...schemes.map((s) => `- \`${s.envVar}\` — ${s.note}`),
  ].join("\n");
}
