/**
 * End-to-end CLI tests: build the `mcpgen` binary and drive it as a child
 * process against fixtures — the closest thing to how a user invokes it. Only
 * offline paths are exercised (no API key, no network), so this is hermetic.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const bin = join(repoRoot, "packages/cli/dist/index.js");
const petstore = join(
  repoRoot,
  "packages/core/test/fixtures/openapi/petstore.yaml",
);

/** Run the built CLI and capture its result. */
function run(args: string[]): {
  stdout: string;
  stderr: string;
  status: number | null;
} {
  const result = spawnSync("node", [bin, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: "1",
      // Force the offline path regardless of the host environment.
      ANTHROPIC_API_KEY: "",
      MCPGEN_ANTHROPIC_API_KEY: "",
    },
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

describe("mcpgen CLI (built binary)", () => {
  beforeAll(() => {
    // Build the CLI and its workspace deps (core, templates) via Turbo.
    execFileSync(
      "pnpm",
      ["exec", "turbo", "run", "build", "--filter=mcpgen"],
      {
        cwd: repoRoot,
        stdio: "ignore",
      },
    );
    expect(existsSync(bin)).toBe(true);
  }, 180_000);

  it("prints its version", () => {
    const { stdout, status } = run(["--version"]);
    expect(status).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("describes the engine via `info`", () => {
    const { stdout, status } = run(["info"]);
    expect(status).toBe(0);
    expect(stdout).toContain("mcpgen core");
  });

  it("reports environment health as JSON via `doctor --json`", () => {
    const { stdout } = run(["doctor", "--json"]);
    const report = JSON.parse(stdout);
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks.map((c: { id: string }) => c.id)).toContain("node");
    // With no key forced, the anthropic-key check warns (never blocks).
    const key = report.checks.find(
      (c: { id: string }) => c.id === "anthropic-key",
    );
    expect(key.status).toBe("warn");
  });

  it("emits a bash completion script", () => {
    const { stdout, status } = run(["completion", "bash"]);
    expect(status).toBe(0);
    expect(stdout).toContain("complete -F _mcpgen mcpgen");
  });

  it("fails helpfully when completion shell is missing", () => {
    const { stderr, status } = run(["completion"]);
    expect(status).toBe(1);
    expect(stderr).toContain("specify a shell");
  });

  it("inspects a source as JSON", () => {
    const { stdout, status } = run(["inspect", petstore, "--json"]);
    expect(status).toBe(0);
    const ir = JSON.parse(stdout);
    expect(ir.tools.length).toBe(5);
  });

  it("generates a project offline and writes files (--json)", () => {
    const out = join(mkdtempSync(join(tmpdir(), "mcpgen-e2e-")), "srv");
    const { stdout, status } = run([
      "generate",
      petstore,
      "--out",
      out,
      "--offline",
      "--no-verify",
      "--json",
    ]);
    expect(status).toBe(0);
    const summary = JSON.parse(stdout);
    expect(summary.toolCount).toBe(5);
    expect(summary.transport).toBe("stdio");
    expect(existsSync(join(out, "package.json"))).toBe(true);
    expect(existsSync(join(out, "src/server.ts"))).toBe(true);
    // The generated README carries client-connect instructions.
    expect(existsSync(join(out, "README.md"))).toBe(true);
  });

  it("shows the summary panel and next steps in human mode", () => {
    const out = join(mkdtempSync(join(tmpdir(), "mcpgen-e2e-")), "srv");
    const { stdout, status } = run([
      "generate",
      petstore,
      "--out",
      out,
      "--offline",
      "--no-verify",
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain("mcpgen · generated");
    expect(stdout).toContain("Next steps:");
    expect(stdout).toContain("npm install && npm run build");
  });

  it("fails with a friendly error on a missing source", () => {
    const { stderr, status } = run([
      "generate",
      join(repoRoot, "nope.yaml"),
      "--out",
      mkdtempSync(join(tmpdir(), "mcpgen-e2e-")),
      "--offline",
    ]);
    expect(status).toBe(1);
    expect(stderr).toContain("source not found");
  });
});
