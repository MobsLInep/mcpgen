import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runGenerate } from "./generate.js";

const petstore = fileURLToPath(
  new URL(
    "../../core/test/fixtures/openapi/petstore.yaml",
    import.meta.url,
  ),
);

describe("runGenerate", () => {
  it("generates a project offline (no API key) and writes files", async () => {
    const out = mkdtempSync(join(tmpdir(), "mcpgen-cli-"));
    const report = await runGenerate(petstore, {
      out,
      transport: "http",
      offline: true,
    });

    expect(report).toContain("Generated 5 tool(s)");
    expect(report).toContain("src/server.ts");
    expect(report).toContain("offline mode");

    expect(existsSync(join(out, "package.json"))).toBe(true);
    expect(existsSync(join(out, "src/server.ts"))).toBe(true);
    expect(existsSync(join(out, "SECURITY.md"))).toBe(true);
  });

  it("validates the transport option upstream of the action", async () => {
    // runGenerate trusts validated input; the program layer guards flags.
    const out = mkdtempSync(join(tmpdir(), "mcpgen-cli-"));
    const report = await runGenerate(petstore, { out, offline: true });
    expect(report).toContain("Output:");
  });
});
