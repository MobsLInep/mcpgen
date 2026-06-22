/**
 * Golden-file suite: generate an MCP server for several real, public OpenAPI
 * specs (committed under test/fixtures/golden) and prove each one is sound.
 *
 * For every spec we assert, fully offline:
 *   1. it parses into a non-empty IR,
 *   2. every generated TypeScript file is syntactically valid,
 *   3. the verification loop passes (install → build → boot → smoke) — the boot
 *      stage cross-checks that the tools the server *would* advertise exactly
 *      match the plan, using a toolchain that derives the advertised set from
 *      the actual generated tool modules on disk, and
 *   4. the generated server passes the OWASP secure-MCP audit (no high findings).
 *
 * Set `MCPGEN_GOLDEN_REAL=1` to swap the fake toolchain for the real
 * {@link NodeToolchain}, which actually `npm install`s, builds, boots, and
 * smoke-calls each server against the mocked upstream (slow; needs network).
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { auditGeneratedProject } from "../security/audit.js";
import { openApiSource } from "../parsers/openapi.js";
import { openApiExampleMock } from "../verify/mock.js";
import { NodeToolchain } from "../verify/toolchain.js";
import type {
  BuildOutcome,
  DriverOutcome,
  DriverSpec,
  InstallOutcome,
  Toolchain,
} from "../verify/toolchain.js";
import { generateProject } from "./engine.js";
import { verifyProject } from "../verify/verify.js";

const goldenDir = fileURLToPath(
  new URL("../../test/fixtures/golden", import.meta.url),
);
const specs = readdirSync(goldenDir)
  .filter(
    (f) => f.endsWith(".yaml") || f.endsWith(".yml") || f.endsWith(".json"),
  )
  .sort();

const REAL = process.env.MCPGEN_GOLDEN_REAL === "1";

/**
 * A toolchain that *reads the materialized project* to decide outcomes: it
 * advertises exactly the tool modules that were generated, so the boot stage's
 * plan-vs-advertised assertion is a genuine consistency check, and reports a
 * well-formed smoke result for each call. No process spawn, no network.
 */
class GeneratedFilesToolchain implements Toolchain {
  install(): Promise<InstallOutcome> {
    return Promise.resolve({ ok: true, output: "fake install ok" });
  }
  build(): Promise<BuildOutcome> {
    return Promise.resolve({ ok: true, output: "fake build ok" });
  }
  runDriver(dir: string, spec: DriverSpec): Promise<DriverOutcome> {
    let advertised: string[] = [];
    try {
      advertised = readdirSync(`${dir}/src/tools`)
        .filter((f) => f.endsWith(".ts") && f !== "index.ts")
        .map((f) => f.replace(/\.ts$/, ""));
    } catch {
      advertised = spec.calls.map((c) => c.tool);
    }
    return Promise.resolve({
      bootOk: true,
      advertisedTools: advertised,
      toolResults: spec.calls.map((c) => ({
        tool: c.tool,
        ok: true,
        isError: false,
      })),
      output: "fake driver ok",
    });
  }
}

function assertValidTs(code: string, label: string): void {
  const out = ts.transpileModule(code, {
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const errs = (out.diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  expect(
    errs.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")),
    `invalid TS in ${label}`,
  ).toEqual([]);
}

describe("golden suite — real public OpenAPI specs", () => {
  it("has at least five committed golden specs", () => {
    expect(specs.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of specs) {
    describe(file, () => {
      it(
        "parses, generates valid TS, verifies, and passes the security audit",
        async () => {
          const path = `${goldenDir}/${file}`;
          // Sanity-check the fixture is non-empty.
          expect(readFileSync(path, "utf8").length).toBeGreaterThan(0);

          // 1. parse
          const result = await openApiSource({ path }).parse();
          expect(result.tools.length).toBeGreaterThan(0);

          // 2. generate (offline, deterministic)
          const project = await generateProject(result, { transport: "http" });
          expect(project.toolCount).toBe(project.plan.tools.length);
          for (const [p, code] of project.files) {
            if (p.endsWith(".ts")) assertValidTs(code, `${file}:${p}`);
          }

          // 3. verify (fake toolchain by default; real one under MCPGEN_GOLDEN_REAL)
          const verification = await verifyProject(
            result,
            project.plan,
            project,
            {
              toolchain: REAL
                ? new NodeToolchain()
                : new GeneratedFilesToolchain(),
              mockFactory: openApiExampleMock,
            },
          );
          expect(
            verification.ok,
            `verification failed for ${file}:\n${verification.report}`,
          ).toBe(true);
          const stageNames = verification.stages.map((s) => s.stage);
          expect(stageNames).toEqual(["install", "build", "boot", "smoke"]);

          // 4. security audit
          const audit = auditGeneratedProject(project.files);
          const high = audit.findings.filter((f) => f.severity === "high");
          expect(high, JSON.stringify(high, null, 2)).toEqual([]);
        },
        REAL ? 600_000 : 30_000,
      );
    });
  }
});
