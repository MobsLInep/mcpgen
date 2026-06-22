/**
 * Integration tests for the verification & self-repair loop.
 *
 * These exercise the loop's orchestration — stage sequencing, repair targeting,
 * the retry cap, event streaming, and report generation — by injecting a
 * {@link FakeToolchain} (the real {@link NodeToolchain} is exercised by the
 * petstore demo, which needs a network install + build). The fake reads the
 * working-copy files the loop materializes, so a repair patch genuinely changes
 * the next pass's outcome, just like the real toolchain.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

const BUILD_FAIL = "@verify-build-fail";
const SMOKE_FAIL = "@verify-smoke-fail";

const petstoreSpec = fileURLToPath(
  new URL("../../test/fixtures/openapi/petstore.yaml", import.meta.url),
);

/**
 * A toolchain that decides outcomes from the materialized files, so repairs that
 * remove a failure marker actually make later passes pass. Never spawns a
 * process or touches the network.
 */
class FakeToolchain implements Toolchain {
  /** Marker → which src file (if any) currently triggers a build failure. */
  install(): Promise<InstallOutcome> {
    return Promise.resolve({ ok: true, output: "fake install ok" });
  }

  build(dir: string): Promise<BuildOutcome> {
    const offender = this.findMarker(dir, BUILD_FAIL);
    if (offender) {
      return Promise.resolve({
        ok: false,
        output: `${offender}(1,1): error TS9999: forced build failure (${BUILD_FAIL})`,
      });
    }
    return Promise.resolve({ ok: true, output: "fake build ok" });
  }

  runDriver(dir: string, spec: DriverSpec): Promise<DriverOutcome> {
    // Advertise exactly the planned tools so the boot stage passes.
    const advertisedTools = spec.calls.map((c) => c.tool);
    const toolResults = spec.calls.map((call) => {
      const file = `src/tools/${call.tool}.ts`;
      const broken = this.fileContains(dir, file, SMOKE_FAIL);
      return broken
        ? { tool: call.tool, ok: false, isError: true, message: `forced smoke failure (${SMOKE_FAIL})` }
        : { tool: call.tool, ok: true, isError: false };
    });
    return Promise.resolve({
      bootOk: true,
      advertisedTools,
      toolResults,
      output: "fake driver ok",
    });
  }

  private findMarker(dir: string, marker: string): string | undefined {
    const srcDir = join(dir, "src");
    let entries: string[];
    try {
      entries = readdirSync(srcDir, { recursive: true }) as string[];
    } catch {
      return undefined;
    }
    for (const entry of entries.sort()) {
      if (!entry.endsWith(".ts")) continue;
      const rel = `src/${entry.split(/[\\/]/).join("/")}`;
      if (this.fileContains(dir, rel, marker)) return rel;
    }
    return undefined;
  }

  private fileContains(dir: string, rel: string, marker: string): boolean {
    try {
      return readFileSync(join(dir, rel), "utf8").includes(marker);
    } catch {
      return false;
    }
  }
}

async function petstoreProject(): Promise<{
  result: ParseResult;
  project: GeneratedProject;
}> {
  const result = await openApiSource({ path: petstoreSpec }).parse();
  const project = await generateProject(result, { transport: "stdio" });
  return { result, project };
}

/** Return a copy of `project` with `path` overwritten by `contents`. */
function withFile(
  project: GeneratedProject,
  path: string,
  contents: string,
): GeneratedProject {
  const files = new Map(project.files);
  files.set(path, contents);
  return { ...project, files };
}

/** A repair client that returns `fixedContent` for the file at `path`. */
function repairClientFor(path: string, fixedContent: string): MockLlmClient {
  return new MockLlmClient({
    [`repair:${path}`]: JSON.stringify({ path, content: fixedContent }),
  });
}

describe("verifyProject", () => {
  it("passes a clean project end-to-end (install → build → boot → smoke)", async () => {
    const { result, project } = await petstoreProject();
    const events: string[] = [];
    const verification = await verifyProject(result, project.plan, project, {
      toolchain: new FakeToolchain(),
      mockFactory: openApiExampleMock,
      onEvent: (e) => events.push(e.type),
    });

    expect(verification.ok).toBe(true);
    expect(verification.passes).toBe(1);
    expect(verification.repairsApplied).toBe(0);
    const stages = verification.stages.map((s) => s.stage);
    expect(stages).toEqual(["install", "build", "boot", "smoke"]);
    expect(verification.stages.every((s) => s.ok)).toBe(true);
    // Streamed progress reached completion.
    expect(events).toContain("stage-result");
    expect(events.at(-1)).toBe("done");
    expect(verification.report).toContain("✅ PASSED");
  });

  it("repairs a build failure and then passes", async () => {
    const { result, project } = await petstoreProject();
    const target = "src/tools/listPets.ts";
    const original = project.files.get(target)!;
    const broken = `// ${BUILD_FAIL}\n${original}`;
    const brokenProject = withFile(project, target, broken);

    const verification = await verifyProject(
      result,
      brokenProject.plan,
      brokenProject,
      {
        toolchain: new FakeToolchain(),
        client: repairClientFor(target, original), // patch removes the marker
        maxRepairs: 3,
      },
    );

    expect(verification.ok).toBe(true);
    expect(verification.passes).toBe(2);
    expect(verification.repairsApplied).toBe(1);
    // The repaired file is reflected in the returned file map.
    expect(verification.files.get(target)).toBe(original);
    expect(verification.report).toContain("patch applied");
  });

  it("repairs a smoke-call failure on the offending tool file", async () => {
    const { result, project } = await petstoreProject();
    const target = "src/tools/createPet.ts";
    const original = project.files.get(target)!;
    const broken = `// ${SMOKE_FAIL}\n${original}`;
    const brokenProject = withFile(project, target, broken);

    const verification = await verifyProject(
      result,
      brokenProject.plan,
      brokenProject,
      {
        toolchain: new FakeToolchain(),
        client: repairClientFor(target, original),
        maxRepairs: 2,
      },
    );

    expect(verification.ok).toBe(true);
    expect(verification.repairsApplied).toBe(1);
    const smoke = verification.stages.find((s) => s.stage === "smoke")!;
    expect(smoke.ok).toBe(true);
  });

  it("gives up and reports after exhausting the repair budget", async () => {
    const { result, project } = await petstoreProject();
    const target = "src/tools/listPets.ts";
    const original = project.files.get(target)!;
    const broken = `// ${BUILD_FAIL}\n${original}`;
    const brokenProject = withFile(project, target, broken);

    // The "fix" still contains the marker → build keeps failing.
    const stillBroken = `// ${BUILD_FAIL} (not actually fixed)\n${original}`;

    const verification = await verifyProject(
      result,
      brokenProject.plan,
      brokenProject,
      {
        toolchain: new FakeToolchain(),
        client: repairClientFor(target, stillBroken),
        maxRepairs: 1,
      },
    );

    expect(verification.ok).toBe(false);
    expect(verification.passes).toBe(2); // initial + one repair pass
    expect(verification.repairsApplied).toBe(1);
    expect(verification.report).toContain("❌ FAILED");
    expect(verification.report).toContain("forced build failure");
    expect(verification.report).toContain(target);
  });

  it("cannot repair without a client, but still reports cleanly", async () => {
    const { result, project } = await petstoreProject();
    const target = "src/tools/listPets.ts";
    const broken = `// ${BUILD_FAIL}\n${project.files.get(target)!}`;
    const brokenProject = withFile(project, target, broken);

    const verification = await verifyProject(
      result,
      brokenProject.plan,
      brokenProject,
      { toolchain: new FakeToolchain() }, // no client
    );

    expect(verification.ok).toBe(false);
    expect(verification.passes).toBe(1);
    expect(verification.repairsApplied).toBe(0);
    expect(verification.report).toContain("no LLM client available");
  });
});
