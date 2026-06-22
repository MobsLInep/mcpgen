import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openApiSource } from "../parsers/openapi.js";
import type { ParseResult } from "../ir.js";
import { ScriptedLlmClient } from "./cache.js";
import { generateProject, writeProject } from "./engine.js";

const openapiFixture = fileURLToPath(
  new URL("../../test/fixtures/openapi/petstore.yaml", import.meta.url),
);
const llmFixtureDir = fileURLToPath(
  new URL("../../test/fixtures/llm/petstore", import.meta.url),
);

async function petstore(): Promise<ParseResult> {
  return openApiSource({ path: openapiFixture }).parse();
}

describe("generateProject (petstore, recorded LLM fixtures)", () => {
  it("renders a complete project from the recorded plan + synthesis", async () => {
    const result = await petstore();
    const client = new ScriptedLlmClient(llmFixtureDir);
    const project = await generateProject(result, {
      client,
      transport: "http",
      auth: "apikey",
    });

    expect(project.serverName).toBe("petstore-mcp");
    expect(project.toolCount).toBe(5);
    expect(project.usedFallback).toBe(false);

    // The expected file tree exists.
    const files = [...project.files.keys()];
    for (const expected of [
      "package.json",
      "tsconfig.json",
      "Dockerfile",
      ".gitignore",
      ".env.example",
      "README.md",
      "SECURITY.md",
      "src/server.ts",
      "src/http.ts",
      "src/runtime.ts",
      "src/config.ts",
      "src/tools/index.ts",
      "src/tools/list_pets.ts",
      "src/tools/create_pet.ts",
      "src/tools/show_pet_by_id.ts",
      "src/tools/update_pet.ts",
      "src/tools/delete_pet.ts",
    ]) {
      expect(files, `missing ${expected}`).toContain(expected);
    }
  });

  it("wires both transports and registers tools in the server entry", async () => {
    const result = await petstore();
    const project = await generateProject(result, {
      client: new ScriptedLlmClient(llmFixtureDir),
      transport: "http",
    });
    const server = project.files.get("src/server.ts")!;
    expect(server).toContain("new McpServer(");
    expect(server).toContain("server.registerTool(");
    expect(server).toContain("StdioServerTransport");
    expect(server).toContain("StreamableHTTPServerTransport");
    // The registry aggregates the tools.
    const index = project.files.get("src/tools/index.ts")!;
    expect(index).toContain('import { tool as t0 } from "./list_pets.js";');
    expect(index).toContain("export const tools: ToolModule[]");
  });

  it("embeds the synthesized schema + safe handler in each tool file", async () => {
    const result = await petstore();
    const project = await generateProject(result, {
      client: new ScriptedLlmClient(llmFixtureDir),
      transport: "http",
    });
    const listPets = project.files.get("src/tools/list_pets.ts")!;
    expect(listPets).toContain("export const inputSchema =");
    expect(listPets).toContain("z.number().int()");
    expect(listPets).toContain("ctx.http.request(");
    expect(listPets).toContain('path: "/pets"');
    expect(listPets).toContain('name: "list_pets"');

    const showPet = project.files.get("src/tools/show_pet_by_id.ts")!;
    expect(showPet).toContain('path: "/pets/{petId}"');
    expect(showPet).toContain("pathParams: { petId: args.petId }");
  });

  it("derives auth config and documents it for the operator", async () => {
    const result = await petstore();
    const project = await generateProject(result, {
      client: new ScriptedLlmClient(llmFixtureDir),
      transport: "http",
    });
    const config = project.files.get("src/config.ts")!;
    // Petstore's createPet/updatePet/deletePet use an X-API-Key header.
    expect(config).toContain('kind: "apiKey"');
    expect(config).toContain('name: "X-API-Key"');
    expect(config).toContain('envVar: "MCPGEN_X_API_KEY"');

    const env = project.files.get(".env.example")!;
    expect(env).toContain("MCPGEN_X_API_KEY=");
    const security = project.files.get("SECURITY.md")!;
    expect(security).toContain("MCPGEN_X_API_KEY");
  });

  it("honors --auth none by emitting no schemes", async () => {
    const result = await petstore();
    const project = await generateProject(result, {
      client: new ScriptedLlmClient(llmFixtureDir),
      transport: "stdio",
      auth: "none",
    });
    const config = project.files.get("src/config.ts")!;
    expect(config).toContain("const AUTH_SCHEMES: AuthScheme[] = [];");
  });

  it("writes the project to disk", async () => {
    const result = await petstore();
    const project = await generateProject(result, {
      client: new ScriptedLlmClient(llmFixtureDir),
      transport: "http",
    });
    const out = mkdtempSync(join(tmpdir(), "mcpgen-"));
    const written = writeProject(project, out);
    expect(written.length).toBe(project.files.size);
    const pkg = readFileSync(join(out, "package.json"), "utf8");
    expect(pkg).toContain('"name": "petstore-mcp"');
    expect(pkg).toContain("@modelcontextprotocol/sdk");
  });
});

describe("generateProject (deterministic, no LLM)", () => {
  it("produces a working project from the IR alone", async () => {
    const result = await petstore();
    const project = await generateProject(result, { transport: "stdio" });
    expect(project.toolCount).toBe(5);
    expect(project.usedFallback).toBe(true);
    // Deterministic plan uses the candidate names as tool names.
    expect(project.files.has("src/tools/listPets.ts")).toBe(true);
    const listPets = project.files.get("src/tools/listPets.ts")!;
    expect(listPets).toContain("ctx.http.request(");
    expect(listPets).toContain('path: "/pets"');
  });
});
