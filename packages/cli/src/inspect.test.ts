import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runInspect } from "./inspect.js";

const petstore = fileURLToPath(
  new URL("../../core/test/fixtures/openapi/petstore.yaml", import.meta.url),
);

describe("runInspect", () => {
  it("renders a table summary for the petstore spec", async () => {
    const out = await runInspect(petstore);
    expect(out).toContain("Kind:      openapi");
    expect(out).toContain("Swagger Petstore");
    expect(out).toContain("Tools:     5");
    expect(out).toContain("createPet");
    expect(out).toContain("POST /pets");
    // Table chrome is present.
    expect(out).toContain("TOOL");
    expect(out).toContain("CONF");
  });

  it("emits raw IR JSON with --json", async () => {
    const out = await runInspect(petstore, { json: true });
    const parsed = JSON.parse(out) as {
      metadata: { kind: string; toolCount: number };
      tools: unknown[];
    };
    expect(parsed.metadata.kind).toBe("openapi");
    expect(parsed.metadata.toolCount).toBe(5);
    expect(parsed.tools).toHaveLength(5);
  });
});
