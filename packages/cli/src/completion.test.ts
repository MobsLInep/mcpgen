import { describe, expect, it } from "vitest";
import { COMPLETION_SHELLS, completionScript } from "./completion.js";

describe("completionScript", () => {
  it("emits a bash completion that registers the mcpgen function", () => {
    const script = completionScript("bash");
    expect(script).toContain("complete -F _mcpgen mcpgen");
    expect(script).toContain("info inspect generate init doctor completion");
    expect(script).toContain("stdio http"); // --transport values
  });

  it("emits a zsh #compdef header", () => {
    const script = completionScript("zsh");
    expect(script.startsWith("#compdef mcpgen")).toBe(true);
    expect(script).toContain("_describe 'command' commands");
  });

  it("emits fish completions for each subcommand", () => {
    const script = completionScript("fish");
    expect(script).toContain("complete -c mcpgen");
    expect(script).toContain("-a generate");
    expect(script).toContain("-a doctor");
  });

  it("covers every advertised shell", () => {
    for (const shell of COMPLETION_SHELLS) {
      expect(completionScript(shell).length).toBeGreaterThan(0);
    }
  });

  it("throws a helpful error for an unknown shell", () => {
    expect(() => completionScript("powershell")).toThrow(/unsupported shell/);
  });
});
