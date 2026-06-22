import { describe, expect, it } from "vitest";
import { buildProgram } from "./program";

describe("@mcpgen/cli", () => {
  it("builds a program named mcpgen", () => {
    const program = buildProgram();
    expect(program.name()).toBe("mcpgen");
  });

  it("registers the info command", () => {
    const program = buildProgram();
    const commands = program.commands.map((c) => c.name());
    expect(commands).toContain("info");
  });

  it("registers the inspect command", () => {
    const program = buildProgram();
    const commands = program.commands.map((c) => c.name());
    expect(commands).toContain("inspect");
  });
});
