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
      ".dockerignore",
      "docker-compose.yml",
      "fly.toml",
      "render.yaml",
      "railway.json",
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

  it("documents how to connect the server to AI clients in the README", async () => {
    const result = await petstore();
    const project = await generateProject(result, {
      client: new ScriptedLlmClient(llmFixtureDir),
      transport: "stdio",
      auth: "apikey",
    });
    const readme = project.files.get("README.md")!;
    // The connect section names all three clients and their config files.
    expect(readme).toContain("Connect this server to an AI client");
    expect(readme).toContain("claude_desktop_config.json");
    expect(readme).toContain(".cursor/mcp.json");
    expect(readme).toContain(".vscode/mcp.json");
    // stdio config launches the compiled entry over a command/args pair.
    expect(readme).toContain('"mcpServers"');
    expect(readme).toContain('"servers"'); // VS Code uses the `servers` key
    expect(readme).toContain('"command": "node"');
    expect(readme).toContain("dist/server.js");
    // Auth env var surfaces in the pasteable config.
    expect(readme).toContain("MCPGEN_X_API_KEY");
    // Copy-paste run + deploy instructions are present.
    expect(readme).toContain("npm run build");
    expect(readme).toContain("docker build -t");
  });

  it("emits deploy targets with a /healthz check and host hardening", async () => {
    const result = await petstore();
    const project = await generateProject(result, {
      client: new ScriptedLlmClient(llmFixtureDir),
      transport: "http",
      auth: "oauth",
    });

    // Health check + DNS-rebinding + CORS land in the server entry.
    const server = project.files.get("src/server.ts")!;
    expect(server).toContain('app.get("/healthz"');
    expect(server).toContain("enableDnsRebindingProtection");
    expect(server).toContain("Access-Control-Allow-Origin");
    // OAuth auth → resource-server discovery is scaffolded.
    expect(server).toContain("/.well-known/oauth-protected-resource");

    // Each host target points at /healthz and builds the Dockerfile.
    const compose = project.files.get("docker-compose.yml")!;
    expect(compose).toContain("MCPGEN_TRANSPORT: http");
    expect(compose).toContain("/healthz");
    const fly = project.files.get("fly.toml")!;
    expect(fly).toContain('path = "/healthz"');
    expect(fly).toContain('dockerfile = "Dockerfile"');
    const render = project.files.get("render.yaml")!;
    expect(render).toContain("healthCheckPath: /healthz");
    expect(render).toContain("MCPGEN_BEARER_TOKEN"); // secret env, sync:false
    expect(render).toContain("sync: false");
    const railway = project.files.get("railway.json")!;
    expect(railway).toContain('"healthcheckPath": "/healthz"');

    // The Dockerfile declares a HEALTHCHECK; README documents the targets.
    expect(project.files.get("Dockerfile")!).toContain("HEALTHCHECK");
    const readme = project.files.get("README.md")!;
    expect(readme).toContain("## Deploy");
    expect(readme).toContain("fly deploy");
    expect(readme).toContain("docker compose up");
    expect(readme).toContain("Blueprint");
    expect(readme).toContain("DNS-rebinding");
  });

  it("omits OAuth discovery when auth is none", async () => {
    const result = await petstore();
    const project = await generateProject(result, {
      client: new ScriptedLlmClient(llmFixtureDir),
      transport: "http",
      auth: "none",
    });
    const server = project.files.get("src/server.ts")!;
    expect(server).not.toContain("/.well-known/oauth-protected-resource");
    // Health check is always present for the http transport.
    expect(server).toContain('app.get("/healthz"');
  });

  it("emits an http URL config in the README for the http transport", async () => {
    const result = await petstore();
    const project = await generateProject(result, {
      client: new ScriptedLlmClient(llmFixtureDir),
      transport: "http",
    });
    const readme = project.files.get("README.md")!;
    expect(readme).toContain('"type": "http"');
    expect(readme).toContain("http://localhost:3000/mcp");
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
