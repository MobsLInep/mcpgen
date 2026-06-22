/**
 * Unit tests for the real {@link NodeToolchain}. These avoid the network and a
 * real build by driving the toolchain with trivial commands: a custom install
 * command, a build with no local `tsc` (expected to fail cleanly), and a driver
 * run whose server cannot boot (the SDK isn't installed in the temp dir) — which
 * still exercises the spawn + result-file plumbing end to end.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DRIVER_SOURCE, NodeToolchain } from "./toolchain.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "mcpgen-tc-"));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("NodeToolchain.install", () => {
  it("reports success for a custom install command that exits 0", async () => {
    const tc = new NodeToolchain({
      installCommand: ["node", "-e", "process.exit(0)"],
    });
    const r = await tc.install(tmp());
    expect(r.ok).toBe(true);
  });

  it("reports failure for a command that exits non-zero", async () => {
    const tc = new NodeToolchain({
      installCommand: ["node", "-e", "process.exit(3)"],
    });
    const r = await tc.install(tmp());
    expect(r.ok).toBe(false);
  });

  it("reports failure (not a throw) when the command is missing", async () => {
    const tc = new NodeToolchain({
      installCommand: ["__mcpgen_no_such_bin__"],
    });
    const r = await tc.install(tmp());
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/ENOENT|not found|spawn/i);
  });
});

describe("NodeToolchain.build", () => {
  it("fails cleanly when the project has no local tsc", async () => {
    const r = await new NodeToolchain().build(tmp());
    expect(r.ok).toBe(false);
    expect(typeof r.output).toBe("string");
  });
});

describe("NodeToolchain.runDriver", () => {
  it("writes the driver + spec and returns a structured outcome even if boot fails", async () => {
    const dir = tmp();
    const outcome = await new NodeToolchain({
      driverTimeoutMs: 15_000,
    }).runDriver(dir, {
      serverEntry: "dist/server.js", // does not exist → server cannot boot
      env: { MCPGEN_API_BASE_URL: "http://127.0.0.1:1" },
      calls: [{ tool: "noop", args: {} }],
    });
    // The driver script and spec were materialized in the work dir.
    expect(existsSync(join(dir, "__mcpgen_driver.mjs"))).toBe(true);
    expect(existsSync(join(dir, "__mcpgen_spec.json"))).toBe(true);
    // Boot failed (no SDK / no server), but the outcome is well-formed.
    expect(outcome.bootOk).toBe(false);
    expect(Array.isArray(outcome.advertisedTools)).toBe(true);
    expect(Array.isArray(outcome.toolResults)).toBe(true);
    expect(typeof outcome.output).toBe("string");
  });
});

describe("DRIVER_SOURCE", () => {
  it("is a self-contained MCP client driver", () => {
    expect(DRIVER_SOURCE).toContain("@modelcontextprotocol/sdk/client");
    expect(DRIVER_SOURCE).toContain("client.listTools()");
    expect(DRIVER_SOURCE).toContain("client.callTool(");
  });
});
