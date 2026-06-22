import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  loadTemplate,
  renderString,
  renderTemplate,
  templates,
  templatesDir,
} from "./index.js";

describe("@mcpgen/templates", () => {
  it("registers the generated-server templates", () => {
    expect(templates.length).toBeGreaterThan(0);
    expect(templates.map((t) => t.id)).toContain("server.ts.tmpl");
  });

  it("resolves a templates directory that contains the files", () => {
    expect(existsSync(`${templatesDir()}/server.ts.tmpl`)).toBe(true);
  });

  it("loads a real template file", () => {
    const server = loadTemplate("server.ts.tmpl");
    expect(server).toContain("McpServer");
    expect(server).toContain("StreamableHTTPServerTransport");
  });

  it("substitutes known tokens and leaves unknown ones intact", () => {
    expect(renderString("hi {{NAME}} {{MISSING}}", { NAME: "bob" })).toBe(
      "hi bob {{MISSING}}",
    );
  });

  it("renders a template file with vars", () => {
    const out = renderTemplate("server.ts.tmpl", {
      SERVER_NAME: "demo-mcp",
      SERVER_VERSION: "1.2.3",
    });
    expect(out).toContain("demo-mcp");
    expect(out).toContain("1.2.3");
    expect(out).not.toContain("{{SERVER_NAME}}");
  });
});
