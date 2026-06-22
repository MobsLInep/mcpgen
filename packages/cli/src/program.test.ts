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

  it("registers the Phase 4 DX commands", () => {
    const program = buildProgram();
    const commands = program.commands.map((c) => c.name());
    expect(commands).toContain("init");
    expect(commands).toContain("doctor");
    expect(commands).toContain("completion");
  });

  it("exposes --json on generate, doctor, and inspect", () => {
    const program = buildProgram();
    const hasJson = (name: string) =>
      program.commands
        .find((c) => c.name() === name)!
        .options.some((o) => o.long === "--json");
    expect(hasJson("generate")).toBe(true);
    expect(hasJson("doctor")).toBe(true);
    expect(hasJson("inspect")).toBe(true);
  });
});
