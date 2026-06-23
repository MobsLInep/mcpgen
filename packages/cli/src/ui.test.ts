import { describe, expect, it } from "vitest";
import {
  friendlyError,
  nextSteps,
  panel,
  summaryPanel,
  summaryRows,
} from "./ui.js";

describe("friendlyError", () => {
  it("maps ENOENT to a path hint", () => {
    const err = Object.assign(new Error("ENOENT: no such file"), {
      code: "ENOENT",
    });
    const out = friendlyError(err);
    expect(out.message).toContain("source not found");
    expect(out.fix).toMatch(/mcpgen inspect/);
  });

  it("maps known core error names to actionable fixes", () => {
    const unknown = Object.assign(new Error("not a recognized source"), {
      name: "UnknownSourceError",
    });
    expect(friendlyError(unknown).fix).toMatch(/OpenAPI|GraphQL/);

    const key = Object.assign(new Error("no key"), {
      name: "MissingApiKeyError",
    });
    expect(friendlyError(key).fix).toMatch(/--offline|ANTHROPIC_API_KEY/);
  });

  it("falls back to the raw message for unknown errors", () => {
    expect(friendlyError(new Error("boom")).message).toBe("boom");
    expect(friendlyError(new Error("boom")).fix).toBeUndefined();
  });
});

describe("panel + summary", () => {
  it("draws a box whose rows share a width", () => {
    const out = panel("title", ["a", "longer line"]);
    const rows = out.split("\n");
    // Measure *visible* width — strip ANSI so the assertion holds whether or
    // not color is enabled (picocolors turns color on under CI, which would
    // otherwise inflate the colored title row's raw length). The regex is built
    // from the ESC char code to avoid a control character in the source.
    const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
    const widths = new Set(rows.map((r) => [...r.replace(ansi, "")].length));
    expect(widths.size).toBe(1);
  });

  it("summaryRows reflects verification state", () => {
    const skipped = summaryRows({
      serverName: "x",
      toolCount: 2,
      outDir: "/out",
      note: "offline",
      usedFallback: false,
      verification: "skipped",
    });
    expect(skipped.join("\n")).toContain("verification skipped");

    const verified = summaryRows({
      serverName: "x",
      toolCount: 2,
      outDir: "/out",
      note: "offline",
      usedFallback: false,
      verification: { ok: true, passes: 1, repairs: 0 },
    });
    expect(verified.join("\n")).toContain("verified");
  });

  it("summaryPanel and nextSteps include the key facts", () => {
    const data = {
      serverName: "petstore-mcp",
      toolCount: 5,
      outDir: "/tmp/out",
      note: "offline mode",
      usedFallback: true,
      verification: "skipped" as const,
    };
    expect(summaryPanel(data)).toContain("petstore-mcp");
    const steps = nextSteps("/tmp/out", "http");
    expect(steps).toContain("cd /tmp/out");
    expect(steps).toContain("MCPGEN_TRANSPORT=http");
    expect(steps).toContain("README.md");
  });
});
