/**
 * Adversarial / fuzz tests: confirm mcpgen *fails safely* on hostile input.
 *
 *  - Malformed specs are rejected with a clear error, never a hang or a crash.
 *  - Injection-y descriptions and parameter names cannot break out of the
 *    generated TypeScript: everything hostile is emitted as an escaped literal,
 *    the output still parses as valid TS, and the security audit stays clean.
 *  - A very large spec is parsed and generated without falling over.
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { auditGeneratedProject } from "../security/audit.js";
import { openApiSource, OpenApiValidationError } from "../parsers/openapi.js";
import { generateProject } from "./engine.js";

/** Assert a string is syntactically valid TypeScript (no parse errors). */
function assertValidTs(code: string, label: string): void {
  const out = ts.transpileModule(code, {
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const syntactic = (out.diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  expect(
    syntactic.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")),
    `invalid TS in ${label}`,
  ).toEqual([]);
}

describe("malformed specs fail safely", () => {
  const cases: Array<[string, unknown]> = [
    ["empty object", {}],
    ["missing paths", { openapi: "3.0.0", info: { title: "x", version: "1" } }],
    ["not openapi at all", { hello: "world" }],
    ["null", null],
    ["a number", 42],
    ["array", [1, 2, 3]],
    ["bad version", { openapi: "9.9.9", info: {}, paths: {} }],
  ];

  for (const [label, data] of cases) {
    it(`rejects ${label} without hanging`, async () => {
      await expect(openApiSource({ data }).parse()).rejects.toBeInstanceOf(
        Error,
      );
    });
  }

  it("rejects unparseable YAML/JSON content", async () => {
    await expect(
      openApiSource({ content: ":\n  - [unbalanced" }).parse(),
    ).rejects.toBeInstanceOf(Error);
  });

  it("surfaces an OpenApiValidationError for a structurally-invalid spec", async () => {
    const data = {
      openapi: "3.0.0",
      info: { title: "x", version: "1" },
      paths: { "/x": { get: {} } },
    };
    await expect(openApiSource({ data }).parse()).rejects.toBeInstanceOf(
      OpenApiValidationError,
    );
  });
});

describe("injection-y content cannot break out of generated code", () => {
  const EVIL = '"; console.log(process.env); throw new Error("x"); //';
  const TEMPLATE_INJECT = "${process.env.SECRET}`; evil(); `";
  const COMMENT_BREAK = "*/ maliciousTopLevel(); /*";
  const TOKEN_INJECT = "{{TOOL_NAME}} {{HANDLER_BODY}}";
  const EVIL_QUERY_NAME = '"]; globalThis.pwned = true; x:["';
  const DESCRIPTION = `${EVIL} ${TEMPLATE_INJECT} ${COMMENT_BREAK} ${TOKEN_INJECT}`;

  function evilSpec() {
    return {
      openapi: "3.0.0",
      info: { title: `${EVIL}`, version: "1.0.0" },
      paths: {
        "/items/{id}": {
          get: {
            operationId: "getItem",
            description: DESCRIPTION,
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                description: COMMENT_BREAK,
                schema: { type: "string" },
              },
              {
                // A hostile query-parameter name.
                name: EVIL_QUERY_NAME,
                in: "query",
                schema: { type: "string" },
              },
            ],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    };
  }

  it("emits hostile descriptions/names as escaped literals (valid TS, clean audit)", async () => {
    const result = await openApiSource({ data: evilSpec() }).parse();
    const project = await generateProject(result, { transport: "http" });

    // Every generated TS file still parses.
    for (const [path, code] of project.files) {
      if (path.endsWith(".ts")) assertValidTs(code, path);
    }

    // The hostile payload is present only as data (escaped), never as code.
    // Valid-TS above is the real proof of containment: had any payload broken
    // out of its string literal, the surrounding quotes would be unbalanced and
    // transpilation would have failed. These assertions pin *how* it's contained.
    const toolFile = [...project.files.entries()].find(
      ([p]) => p.startsWith("src/tools/") && !p.endsWith("index.ts"),
    )![1];
    // The description is embedded as a single JSON-escaped string literal.
    expect(toolFile).toContain(JSON.stringify(DESCRIPTION));
    // The hostile query-parameter name is emitted as a quoted key and a bracketed
    // arg index — never as a bare identifier that could form a statement.
    expect(toolFile).toContain(
      `${JSON.stringify(EVIL_QUERY_NAME)}: args[${JSON.stringify(EVIL_QUERY_NAME)}]`,
    );
    // It must NOT appear as a bare top-level statement (start of a line).
    expect(toolFile).not.toMatch(/^\s*console\.log\(process\.env\)/m);
    expect(toolFile).not.toMatch(/^\s*maliciousTopLevel\(\);/m);
    expect(toolFile).not.toMatch(/^\s*globalThis\.pwned = true;/m);

    // The audit finds nothing high-severity.
    const high = auditGeneratedProject(project.files).findings.filter(
      (f) => f.severity === "high",
    );
    expect(high).toEqual([]);
  });

  it("does not re-expand {{TOKEN}} sequences hidden in user content", async () => {
    const result = await openApiSource({ data: evilSpec() }).parse();
    const project = await generateProject(result, { transport: "http" });
    const toolFile = [...project.files.entries()].find(
      ([p]) => p.startsWith("src/tools/") && !p.endsWith("index.ts"),
    )![1];
    // The literal `{{TOOL_NAME}}` survives as text in the description string —
    // it was NOT substituted with the real tool name (no template re-injection).
    expect(toolFile).toContain("{{TOOL_NAME}}");
  });
});

describe("huge specs are handled without falling over", () => {
  it("parses and generates a 400-operation spec", async () => {
    const paths: Record<string, unknown> = {};
    for (let i = 0; i < 200; i += 1) {
      paths[`/resource${i}/{id}`] = {
        // Path-level parameter shared by both operations.
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        get: {
          operationId: `getResource${i}`,
          responses: { "200": { description: "ok" } },
        },
        post: {
          operationId: `createResource${i}`,
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { "201": { description: "created" } },
        },
      };
    }
    const data = {
      openapi: "3.0.0",
      info: { title: "Huge", version: "1.0.0" },
      paths,
    };

    const result = await openApiSource({ data }).parse();
    expect(result.tools).toHaveLength(400);
    // All names unique.
    expect(new Set(result.tools.map((t) => t.name)).size).toBe(400);

    const project = await generateProject(result, { transport: "stdio" });
    expect(project.toolCount).toBe(400);
    // One module per tool + the shared files.
    const toolModules = [...project.files.keys()].filter(
      (p) => p.startsWith("src/tools/") && !p.endsWith("index.ts"),
    );
    expect(toolModules).toHaveLength(400);
  }, 30_000);
});
