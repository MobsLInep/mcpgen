/**
 * Tests for the OWASP secure-MCP audit. Two angles:
 *  - the rules fire on planted anti-patterns (so the lint is not vacuous), and
 *  - a real generated project passes with zero high-severity findings (so the
 *    generator actually upholds the checklist it documents).
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openApiSource } from "../parsers/openapi.js";
import { generateProject } from "../generate/engine.js";
import { auditFiles, auditGeneratedProject } from "./audit.js";

const petstore = fileURLToPath(
  new URL("../../test/fixtures/openapi/petstore.yaml", import.meta.url),
);

async function generatedFiles(
  auth: "apikey" | "oauth" | "none" = "apikey",
  transport: "stdio" | "http" = "http",
): Promise<ReadonlyMap<string, string>> {
  const result = await openApiSource({ path: petstore }).parse();
  const project = await generateProject(result, { transport, auth });
  return project.files;
}

describe("auditGeneratedProject", () => {
  it("passes a real generated project with no high-severity findings", async () => {
    const audit = auditGeneratedProject(await generatedFiles("apikey", "http"));
    const high = audit.findings.filter((f) => f.severity === "high");
    expect(high, JSON.stringify(high, null, 2)).toEqual([]);
    expect(audit.ok).toBe(true);
    // Every checklist item is reported (and all should pass on clean output).
    const ids = audit.checklist.map((c) => c.id);
    expect(ids).toContain("no-secret-in-logs");
    expect(ids).toContain("inputs-validated");
    expect(ids).toContain("no-shell-or-eval");
    expect(ids).toContain("no-raw-fetch");
    expect(ids).toContain("scoped-credentials");
    expect(ids).toContain("dns-rebinding-guard");
    expect(ids).toContain("review-surface");
    expect(audit.checklist.every((c) => c.passed)).toBe(true);
  });

  it("passes for every transport/auth combination", async () => {
    for (const transport of ["stdio", "http"] as const) {
      for (const auth of ["apikey", "oauth", "none"] as const) {
        const audit = auditGeneratedProject(
          await generatedFiles(auth, transport),
        );
        expect(
          audit.ok,
          `high findings for ${transport}/${auth}: ${JSON.stringify(
            audit.findings.filter((f) => f.severity === "high"),
          )}`,
        ).toBe(true);
      }
    }
  });
});

describe("audit rules fire on anti-patterns", () => {
  it("flags a secret written to a log", () => {
    const files = {
      "src/tools/leak.ts": `
        import { z } from "zod";
        export const inputSchema = {};
        const token = process.env.MCPGEN_BEARER_TOKEN;
        console.log("using token", token);
      `,
    };
    const audit = auditFiles(files, { mode: "source" });
    expect(audit.findings.some((f) => f.rule === "no-secret-in-logs")).toBe(
      true,
    );
    expect(audit.ok).toBe(false);
  });

  it("flags shell/eval sinks (strict rule in a generated project)", () => {
    const files = {
      "src/tools/run.ts": `
        import { z } from "zod";
        import { execSync } from "node:child_process";
        export const inputSchema = {};
        export function handler(args) {
          execSync(args.cmd);
          eval(args.code);
        }
      `,
    };
    const audit = auditFiles(files, { mode: "project" });
    const rules = audit.findings.map((f) => f.rule);
    expect(rules).toContain("no-shell-or-eval");
    expect(
      audit.findings.some((f) => f.message.includes("child_process")),
    ).toBe(true);
  });

  it("flags eval / shell-string exec universally (source mode)", () => {
    const files = {
      "lib/util.ts": `
        export function run(code, cmd) {
          eval(code);
          execSync(cmd);
        }
      `,
    };
    const audit = auditFiles(files, { mode: "source" });
    expect(audit.findings.some((f) => f.rule === "no-dynamic-eval")).toBe(true);
    expect(audit.ok).toBe(false);
  });

  it("does not flag safe argv subprocess or regex .exec() in source mode", () => {
    const files = {
      "lib/probe.ts": `
        import { execFile, spawn } from "node:child_process";
        const m = /foo/.exec(input);
        execFile("docker", ["--version"]);
        spawn("npm", ["install"]);
      `,
    };
    const audit = auditFiles(files, { mode: "source" });
    expect(audit.findings).toEqual([]);
  });

  it("flags a raw fetch outside the safe http client", () => {
    const files = {
      "src/tools/raw.ts": `
        import { z } from "zod";
        export const inputSchema = {};
        export async function handler(args) {
          return fetch("https://api.example.com/" + args.id);
        }
      `,
    };
    const audit = auditFiles(files, { mode: "project" });
    expect(audit.findings.some((f) => f.rule === "no-raw-fetch")).toBe(true);
  });

  it("does not flag fetch inside src/http.ts (the one safe place)", () => {
    const files = {
      "src/http.ts": `export async function go() { return fetch("https://x"); }`,
    };
    const audit = auditFiles(files, { mode: "project" });
    expect(audit.findings.some((f) => f.rule === "no-raw-fetch")).toBe(false);
  });

  it("runs only universal rules in source mode", () => {
    const files = {
      // Missing inputSchema would trip the generated-only `inputs-validated`
      // rule in project mode, but not in source mode.
      "src/tools/x.ts":
        "export async function handler(a, c) { return c.http.request({}); }",
    };
    const sourceIds = auditFiles(files, { mode: "source" }).checklist.map(
      (c) => c.id,
    );
    expect(sourceIds).toEqual([
      "no-secret-in-logs",
      "no-dynamic-eval",
      "scoped-credentials",
    ]);
    expect(auditFiles(files, { mode: "source" }).findings).toEqual([]);
    // In project mode the generated rule fires.
    expect(
      auditFiles(files, { mode: "project" }).findings.some(
        (f) => f.rule === "inputs-validated",
      ),
    ).toBe(true);
  });

  it("flags a tool module with no Zod input schema", () => {
    const files = {
      "src/tools/unvalidated.ts": `
        export async function handler(args, ctx) {
          return ctx.http.request({ method: "GET", path: "/" + args.id });
        }
      `,
    };
    const audit = auditFiles(files, { mode: "project" });
    expect(audit.findings.some((f) => f.rule === "inputs-validated")).toBe(
      true,
    );
  });

  it("flags a hardcoded credential", () => {
    const files = {
      "src/config.ts": `const apiKey = "sk-abcdef0123456789abcdef";`,
    };
    const audit = auditFiles(files, { mode: "source" });
    expect(audit.findings.some((f) => f.rule === "scoped-credentials")).toBe(
      true,
    );
  });

  it("flags an http server missing DNS-rebinding protection", () => {
    const files = {
      "src/server.ts": `
        import { StreamableHTTPServerTransport } from "x";
        const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      `,
      "src/tools/a.ts": `import { z } from "zod"; export const inputSchema = {};`,
    };
    const audit = auditFiles(files, { mode: "project" });
    expect(audit.findings.some((f) => f.rule === "dns-rebinding-guard")).toBe(
      true,
    );
  });

  it("does not flag a secret-shaped word in a comment", () => {
    const files = {
      "src/note.ts": `
        // This handler never logs the api_key or token to the console.
        export const x = 1;
      `,
    };
    const audit = auditFiles(files, { mode: "source" });
    expect(audit.findings).toEqual([]);
  });

  it("ignores project-wide checks in source mode", () => {
    // A bare server file with no tools should not trigger review-surface.
    const files = { "src/server.ts": "export const x = 1;" };
    const audit = auditFiles(files, { mode: "source" });
    expect(audit.findings).toEqual([]);
  });
});
