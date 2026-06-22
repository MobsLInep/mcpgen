/**
 * Branch-coverage tests for the verification loop's less-common paths:
 * environmental install failure, boot tool-set mismatch, a repair that throws,
 * a missing offending file, and dist→src offending-file mapping.
 */
import { describe, expect, it } from "vitest";
import { MockLlmClient } from "../generate/llm.js";
import { openApiSource } from "../parsers/openapi.js";
import { generateProject } from "../generate/engine.js";
import type { GeneratedProject } from "../generate/assemble.js";
import type { ParseResult } from "../ir.js";
import { openApiExampleMock } from "./mock.js";
import type {
  BuildOutcome,
  DriverOutcome,
  DriverSpec,
  InstallOutcome,
  Toolchain,
} from "./toolchain.js";
import { verifyProject } from "./verify.js";
import { fileURLToPath } from "node:url";

const petstoreSpec = fileURLToPath(
  new URL("../../test/fixtures/openapi/petstore.yaml", import.meta.url),
);

async function petstoreProject(): Promise<{
  result: ParseResult;
  project: GeneratedProject;
}> {
  const result = await openApiSource({ path: petstoreSpec }).parse();
  const project = await generateProject(result, { transport: "stdio" });
  return { result, project };
}

/** Base passing toolchain; override individual stages per test. */
class BaseToolchain implements Toolchain {
  install(): Promise<InstallOutcome> {
    return Promise.resolve({ ok: true, output: "ok" });
  }
  build(): Promise<BuildOutcome> {
    return Promise.resolve({ ok: true, output: "ok" });
  }
  runDriver(_dir: string, spec: DriverSpec): Promise<DriverOutcome> {
    return Promise.resolve({
      bootOk: true,
      advertisedTools: spec.calls.map((c) => c.tool),
      toolResults: spec.calls.map((c) => ({
        tool: c.tool,
        ok: true,
        isError: false,
      })),
      output: "ok",
    });
  }
}

describe("verifyProject — environmental & mismatch paths", () => {
  it("stops at an install failure (not LLM-repairable)", async () => {
    const { result, project } = await petstoreProject();
    class InstallFails extends BaseToolchain {
      install(): Promise<InstallOutcome> {
        return Promise.resolve({ ok: false, output: "npm ERR! network" });
      }
    }
    const v = await verifyProject(result, project.plan, project, {
      toolchain: new InstallFails(),
      client: new MockLlmClient({}),
    });
    expect(v.ok).toBe(false);
    expect(v.stages.map((s) => s.stage)).toEqual(["install"]);
    expect(v.repairsApplied).toBe(0);
    expect(v.report).toContain("Install dependencies");
  });

  it("fails boot when advertised tools do not match the plan", async () => {
    const { result, project } = await petstoreProject();
    class BootMismatch extends BaseToolchain {
      runDriver(): Promise<DriverOutcome> {
        return Promise.resolve({
          bootOk: true,
          advertisedTools: ["totally_unexpected_tool"], // missing all + one extra
          toolResults: [],
          output: "ok",
        });
      }
    }
    const v = await verifyProject(result, project.plan, project, {
      toolchain: new BootMismatch(),
    });
    expect(v.ok).toBe(false);
    const boot = v.stages.find((s) => s.stage === "boot")!;
    expect(boot.ok).toBe(false);
    expect(boot.detail).toContain("do not match the plan");
    expect(boot.detail).toMatch(/missing:/);
    expect(boot.detail).toMatch(/unexpected:/);
  });

  it("records a clean failure when the server fails to boot entirely", async () => {
    const { result, project } = await petstoreProject();
    class NoBoot extends BaseToolchain {
      runDriver(): Promise<DriverOutcome> {
        return Promise.resolve({
          bootOk: false,
          advertisedTools: [],
          toolResults: [],
          output: "server crashed on startup",
        });
      }
    }
    const v = await verifyProject(result, project.plan, project, {
      toolchain: new NoBoot(),
    });
    expect(v.ok).toBe(false);
    expect(v.stages.find((s) => s.stage === "boot")!.detail).toContain(
      "failed to boot",
    );
  });

  it("reports a repair that throws (malformed model patch)", async () => {
    const { result, project } = await petstoreProject();
    class BuildFails extends BaseToolchain {
      build(): Promise<BuildOutcome> {
        return Promise.resolve({
          ok: false,
          output: "src/server.ts(1,1): error TS1005",
        });
      }
    }
    // The repair client returns non-JSON → repairFile throws → loop records it.
    const v = await verifyProject(result, project.plan, project, {
      toolchain: new BuildFails(),
      client: new MockLlmClient({ "repair:src/server.ts": "sorry, I cannot" }),
      maxRepairs: 2,
    });
    expect(v.ok).toBe(false);
    expect(v.report).toContain("repair failed");
  });

  it("maps a dist runtime path back to its source file for repair", async () => {
    const { result, project } = await petstoreProject();
    class BuildFailsDist extends BaseToolchain {
      build(): Promise<BuildOutcome> {
        // Reference a dist path → loop maps it to src/tools/listPets.ts.
        return Promise.resolve({
          ok: false,
          output: "Error at dist/tools/listPets.js:10 boom",
        });
      }
    }
    const original = project.files.get("src/tools/listPets.ts")!;
    const v = await verifyProject(result, project.plan, project, {
      toolchain: new BuildFailsDist(),
      // First build fails; the "fix" doesn't matter because our fake build always
      // fails — but we assert the loop targeted the mapped src file.
      client: new MockLlmClient({
        "repair:src/tools/listPets.ts": JSON.stringify({
          path: "src/tools/listPets.ts",
          content: original,
        }),
      }),
      maxRepairs: 1,
    });
    expect(v.repairsApplied).toBe(1);
    expect(v.report).toContain("src/tools/listPets.ts");
  });

  it("reports when the offending file cannot be located in the project", async () => {
    const { result, project } = await petstoreProject();
    // Remove server.ts so the default offending target is absent.
    const files = new Map(project.files);
    files.delete("src/server.ts");
    const stripped: GeneratedProject = { ...project, files };

    class BuildFailsNoSrc extends BaseToolchain {
      build(): Promise<BuildOutcome> {
        return Promise.resolve({
          ok: false,
          output: "opaque failure, no file path",
        });
      }
    }
    const v = await verifyProject(result, stripped.plan, stripped, {
      toolchain: new BuildFailsNoSrc(),
      client: new MockLlmClient({}),
      maxRepairs: 2,
    });
    expect(v.ok).toBe(false);
    expect(v.report).toContain("could not locate the offending file");
  });

  it("keeps the work dir when asked (debugging aid)", async () => {
    const { result, project } = await petstoreProject();
    const v = await verifyProject(result, project.plan, project, {
      toolchain: new BaseToolchain(),
      mockFactory: openApiExampleMock,
      keepWorkDir: true,
    });
    expect(v.ok).toBe(true);
  });
});
