/**
 * @fileoverview The OWASP secure-MCP audit — an automated lint over generated
 * MCP server output (and over mcpgen's own source).
 *
 * This encodes the checklist mcpgen promises in every generated `SECURITY.md`
 * as executable rules, so the guarantees are *tested* rather than merely
 * documented. The audit is a pure function over a `path → contents` map: it
 * performs no I/O and no LLM calls, which keeps it runnable in unit tests, in
 * CI, and as a standalone lint (`scripts/security-lint.mjs`).
 *
 * The checklist (mirrors OWASP's "Securing the Model Context Protocol"):
 *   1. no-secret-in-logs   — credentials/secrets never reach a log sink.
 *   2. inputs-validated    — every tool registers a Zod input schema.
 *   3. no-shell-or-eval    — no shell/exec/eval of any input.
 *   4. no-raw-fetch        — upstream URLs are built in exactly one safe place.
 *   5. scoped-credentials  — secrets come from env, never hardcoded.
 *   6. dns-rebinding-guard — the http transport wires rebinding protection.
 *   7. review-surface      — write operations are surfaced for human review.
 */

/** Severity of a single finding. */
export type Severity = "high" | "medium" | "low";

/** One thing the audit flagged. */
export interface SecurityFinding {
  /** Checklist rule id, e.g. `no-secret-in-logs`. */
  readonly rule: string;
  readonly severity: Severity;
  /** File the finding is in (`<project>` for project-wide checks). */
  readonly file: string;
  /** 1-based line number, when the finding maps to a single line. */
  readonly line?: number;
  readonly message: string;
}

/** Per-rule pass/fail summary (for human-readable lint output). */
export interface ChecklistItem {
  readonly id: string;
  readonly description: string;
  readonly passed: boolean;
  /** Number of findings this rule produced. */
  readonly findings: number;
}

/** The result of an audit. */
export interface AuditResult {
  readonly findings: readonly SecurityFinding[];
  readonly checklist: readonly ChecklistItem[];
  /** True when no `high`-severity finding was produced. */
  readonly ok: boolean;
}

/** A `path → contents` view of the thing being audited. */
export type FileMap = ReadonlyMap<string, string> | Record<string, string>;

function toEntries(files: FileMap): Array<[string, string]> {
  return files instanceof Map
    ? [...files.entries()]
    : Object.entries(files as Record<string, string>);
}

/** Tokens that name a credential/secret in source. */
const SECRET_WORDS =
  /\b(secret|token|password|passwd|api[-_]?key|apikey|authorization|credential|bearer|private[-_]?key)\b/i;

/** Find the 1-based line number of a character offset. */
function lineAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i += 1) {
    if (content[i] === "\n") line += 1;
  }
  return line;
}

/** Strip `//` and `/* *\/` comments so rules don't fire on prose/docs. */
function stripComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1: string) => p1);
}

/**
 * Where a rule is valid:
 *  - `generated` rules encode invariants that hold for *generated MCP server*
 *    code specifically (e.g. a handler must never touch the process or build a
 *    URL itself). They only run in `project` mode.
 *  - `any` rules are universal hygiene (no secret in logs, no hardcoded
 *    credential, no eval/shell-string-exec) and run in both modes — including
 *    over mcpgen's own first-party source.
 */
type RuleScope = "generated" | "any";

/** A rule operates over each source file and pushes findings. */
interface Rule {
  readonly id: string;
  readonly description: string;
  /** When the rule is valid (default `generated`). */
  readonly scope: RuleScope;
  /** Files this rule applies to (by path predicate). */
  readonly applies: (path: string) => boolean;
  readonly check: (
    path: string,
    code: string,
    push: (f: Omit<SecurityFinding, "rule">) => void,
  ) => void;
}

const isTs = (p: string): boolean => p.endsWith(".ts") && !p.endsWith(".d.ts");
const isToolFile = (p: string): boolean =>
  /(^|\/)src\/tools\/[^/]+\.ts$/.test(p) && !p.endsWith("index.ts");

/**
 * Rule 1 — no secret in logs. A `console.*` / `logger.*` call whose argument
 * mentions a credential token (or interpolates `process.env.*SECRET*`) is a
 * leak. Logging an *error object* is fine; logging a secret value is not.
 */
const noSecretInLogs: Rule = {
  id: "no-secret-in-logs",
  description: "Credentials and secrets are never written to a log sink.",
  scope: "any",
  applies: isTs,
  check(path, raw, push) {
    const code = stripComments(raw);
    const logCall = /\b(?:console|logger|log)\s*\.\s*\w+\s*\(([^;]*?)\)/g;
    let m: RegExpExecArray | null;
    while ((m = logCall.exec(code)) !== null) {
      const args = m[1] ?? "";
      // process.env.X_TOKEN / .X_SECRET / .X_KEY interpolated into a log.
      const envSecret =
        /process\.env\.[A-Z0-9_]*(SECRET|TOKEN|KEY|PASSWORD|AUTH)[A-Z0-9_]*/.test(
          args,
        );
      const named = SECRET_WORDS.test(args) && /\$\{|\+|,/.test(args);
      if (envSecret || named) {
        push({
          severity: "high",
          file: path,
          line: lineAt(code, m.index),
          message: `Log statement appears to include a secret: ${m[0]
            .slice(0, 80)
            .replace(/\s+/g, " ")}…`,
        });
      }
    }
  },
};

/**
 * Rule 2 — every tool validates input. A generated tool module must export an
 * `inputSchema` (the Zod raw shape registered with `registerTool`, which the
 * SDK validates before the handler runs). A tool file without one means an
 * unvalidated handler.
 */
const inputsValidated: Rule = {
  id: "inputs-validated",
  description:
    "Every tool registers a Zod input schema (inputs are validated).",
  scope: "generated",
  applies: isToolFile,
  check(path, code, push) {
    if (
      !/\binputSchema\b/.test(code) ||
      !/from "zod"|require\("zod"\)/.test(code)
    ) {
      push({
        severity: "high",
        file: path,
        message:
          "Tool module does not declare a Zod `inputSchema`; inputs would reach the handler unvalidated.",
      });
    }
  },
};

/**
 * Rule 3 — no shell/eval of input. Generated servers must never spawn a shell,
 * `eval`, or build a `Function` from a string. Any of these in generated code
 * is an injection sink.
 */
const noShellOrEval: Rule = {
  id: "no-shell-or-eval",
  description:
    "No process execution, eval, or dynamic Function() in tool code.",
  scope: "generated",
  applies: isTs,
  check(path, raw, push) {
    const code = stripComments(raw);
    const sinks: Array<[RegExp, string]> = [
      [/\bchild_process\b/, "child_process import"],
      [
        /\b(?:exec|execSync|execFile|spawn|spawnSync)\s*\(/,
        "process execution",
      ],
      [/(?<![.\w])eval\s*\(/, "eval()"],
      [/\bnew\s+Function\s*\(/, "new Function()"],
    ];
    for (const [re, label] of sinks) {
      const m = re.exec(code);
      if (m) {
        push({
          severity: "high",
          file: path,
          line: lineAt(code, m.index),
          message: `Dangerous sink (${label}) in generated server code.`,
        });
      }
    }
  },
};

/**
 * Rule 3b — universal injection hygiene (runs over our own source too). Unlike
 * the strict generated-only rule above, this flags only *unambiguous* injection
 * sinks that are never acceptable anywhere: a shell-string `exec`/`execSync`
 * (not the safe argv-form `execFile`/`spawn`, and not a regex's `.exec()`),
 * `eval`, `new Function`, and `{ shell: true }`. First-party code that shells
 * out does so via argv with a fixed command, so it passes.
 */
const noDynamicEval: Rule = {
  id: "no-dynamic-eval",
  description:
    "No eval, dynamic Function(), shell-string exec, or `shell: true` anywhere.",
  scope: "any",
  applies: isTs,
  check(path, raw, push) {
    const code = stripComments(raw);
    const sinks: Array<[RegExp, string]> = [
      [/(?<![.\w])eval\s*\(/, "eval()"],
      [/\bnew\s+Function\s*\(/, "new Function()"],
      // child_process.exec / execSync run a *shell string* (injection-prone);
      // the negative lookbehind skips `regex.exec(...)` and `.execSync`.
      [/(?<![.\w])exec(?:Sync)?\s*\(/, "shell-string exec"],
      [/\bshell\s*:\s*true\b/, "shell: true"],
    ];
    for (const [re, label] of sinks) {
      const m = re.exec(code);
      if (m) {
        push({
          severity: "high",
          file: path,
          line: lineAt(code, m.index),
          message: `Dangerous sink (${label}).`,
        });
      }
    }
  },
};

/**
 * Rule 4 — no raw upstream calls. `fetch(` must live only in `src/http.ts`, the
 * one place that encodes path/query safely. A `fetch` (or template-literal URL)
 * inside a tool handler means raw input could be spliced into a URL.
 */
const noRawFetch: Rule = {
  id: "no-raw-fetch",
  description:
    "Upstream URLs are built in one safe client (src/http.ts), never in handlers.",
  scope: "generated",
  applies: (p) => isTs(p) && p !== "src/http.ts" && !p.endsWith("/http.ts"),
  check(path, raw, push) {
    const code = stripComments(raw);
    const m = /\bfetch\s*\(/.exec(code);
    if (m) {
      push({
        severity: "high",
        file: path,
        line: lineAt(code, m.index),
        message:
          "Raw fetch() outside the safe http client; upstream calls must go through ctx.http.request.",
      });
    }
  },
};

/**
 * Rule 5 — scoped credentials only. Secrets must be read from `process.env`,
 * never hardcoded. Flags an obvious hardcoded bearer/api-key literal.
 */
const scopedCredentials: Rule = {
  id: "scoped-credentials",
  description: "Credentials are read from the environment, never hardcoded.",
  scope: "any",
  applies: isTs,
  check(path, raw, push) {
    const code = stripComments(raw);
    const patterns: RegExp[] = [
      /["'`]Bearer\s+[A-Za-z0-9_\-.]{12,}["'`]/,
      /\b(api[-_]?key|apikey|token|secret|password)\s*[:=]\s*["'`][A-Za-z0-9_\-./+]{12,}["'`]/i,
      /\bsk-[A-Za-z0-9]{16,}\b/,
    ];
    for (const re of patterns) {
      const m = re.exec(code);
      if (m) {
        push({
          severity: "high",
          file: path,
          line: lineAt(code, m.index),
          message: `Possible hardcoded credential: ${m[0].slice(0, 40)}…`,
        });
      }
    }
  },
};

/** Rules that run per-file. */
const FILE_RULES: readonly Rule[] = [
  noSecretInLogs,
  inputsValidated,
  noShellOrEval,
  noDynamicEval,
  noRawFetch,
  scopedCredentials,
];

/** A project-wide check (runs once over the whole file map). */
interface ProjectCheck {
  readonly id: string;
  readonly description: string;
  readonly check: (
    entries: Array<[string, string]>,
    push: (f: Omit<SecurityFinding, "rule">) => void,
  ) => void;
}

/**
 * Rule 6 — the http transport must wire DNS-rebinding protection. (Project
 * check because it spans server.ts + config.ts.)
 */
const dnsRebindingGuard: ProjectCheck = {
  id: "dns-rebinding-guard",
  description:
    "The Streamable HTTP transport wires DNS-rebinding protection (allow-list).",
  check(entries, push) {
    const server = entries.find(([p]) => p.endsWith("src/server.ts"))?.[1];
    if (!server) return; // not an MCP server project
    if (
      server.includes("StreamableHTTPServerTransport") &&
      !server.includes("enableDnsRebindingProtection")
    ) {
      push({
        severity: "medium",
        file: "src/server.ts",
        message:
          "Streamable HTTP transport without enableDnsRebindingProtection; remote clients are exposed to DNS rebinding.",
      });
    }
  },
};

/**
 * Rule 7 — review surface. Every generated project ships a SECURITY.md that
 * surfaces each tool for human review (so write operations get explicit
 * scrutiny before deploy).
 */
const reviewSurface: ProjectCheck = {
  id: "review-surface",
  description: "Generated project ships a SECURITY.md review checklist.",
  check(entries, push) {
    const hasTools = entries.some(([p]) => isToolFile(p));
    if (!hasTools) return; // not a generated project
    const security = entries.find(([p]) => p.endsWith("SECURITY.md"))?.[1];
    if (!security || !/review/i.test(security)) {
      push({
        severity: "medium",
        file: "SECURITY.md",
        message:
          "Generated project is missing a SECURITY.md review checklist for its tools.",
      });
    }
  },
};

const PROJECT_CHECKS: readonly ProjectCheck[] = [
  dnsRebindingGuard,
  reviewSurface,
];

/**
 * Run the secure-MCP checklist over a set of files. Use `mode: "project"`
 * (default) for a generated MCP server (runs the project-wide checks too); use
 * `mode: "source"` to lint an arbitrary source tree (per-file rules only).
 */
export function auditFiles(
  files: FileMap,
  options: { mode?: "project" | "source" } = {},
): AuditResult {
  const mode = options.mode ?? "project";
  const entries = toEntries(files);
  const findings: SecurityFinding[] = [];
  const counts = new Map<string, number>();

  const record = (rule: string, f: Omit<SecurityFinding, "rule">): void => {
    findings.push({ rule, ...f });
    counts.set(rule, (counts.get(rule) ?? 0) + 1);
  };

  // In `source` mode only the universal (`any`-scope) rules apply; the
  // generated-server-specific rules would mis-fire on infrastructure code.
  const activeRules = FILE_RULES.filter(
    (r) => mode === "project" || r.scope === "any",
  );

  for (const rule of activeRules) {
    for (const [path, code] of entries) {
      if (!rule.applies(path)) continue;
      rule.check(path, code, (f) => record(rule.id, f));
    }
  }

  const checklist: ChecklistItem[] = activeRules.map((r) => ({
    id: r.id,
    description: r.description,
    passed: (counts.get(r.id) ?? 0) === 0,
    findings: counts.get(r.id) ?? 0,
  }));

  if (mode === "project") {
    for (const pc of PROJECT_CHECKS) {
      pc.check(entries, (f) => record(pc.id, f));
      checklist.push({
        id: pc.id,
        description: pc.description,
        passed: (counts.get(pc.id) ?? 0) === 0,
        findings: counts.get(pc.id) ?? 0,
      });
    }
  }

  const ok = !findings.some((f) => f.severity === "high");
  return { findings, checklist, ok };
}

/** Convenience: audit a generated project's file map. */
export function auditGeneratedProject(files: FileMap): AuditResult {
  return auditFiles(files, { mode: "project" });
}
