import { describe, expect, it } from "vitest";
import { CORE_VERSION, describeEngine } from "./index";

describe("@mcpgen/core", () => {
  it("exposes a version", () => {
    expect(CORE_VERSION).toBe("0.0.0");
  });

  it("describes the engine", () => {
    expect(describeEngine()).toContain("mcpgen core");
  });
});
