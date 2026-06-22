/**
 * Property-based tests for the OpenAPI parser.
 *
 * Instead of a handful of hand-written specs, fast-check generates thousands of
 * structurally-valid OpenAPI 3.0 documents (varied paths, methods, weird
 * operationIds, path/query parameters) and asserts the parser's *invariants*
 * hold for every one of them: it never throws, tool names are always MCP-safe
 * and unique, the IR mirrors the spec, and the generated server always passes
 * the security audit with no high-severity findings.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { auditGeneratedProject } from "../security/audit.js";
import { generateProject } from "../generate/engine.js";
import { sanitizeToolName } from "../ir.js";
import { openApiSource } from "./openapi.js";

/** A short, mostly-identifier-ish token (sometimes with hostile characters). */
const token = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 _.\-/{}]{0,12}$/);

/** A path segment that is a literal or a `{param}` placeholder. */
const segment = fc.oneof(
  fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/).map((s) => ({ literal: s })),
  fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/).map((p) => ({ param: p })),
);

interface BuiltPath {
  readonly path: string;
  readonly pathParams: string[];
}

/** Build a `/a/{b}/c` path and the names of its placeholders. */
const pathArb: fc.Arbitrary<BuiltPath> = fc
  .array(segment, { minLength: 1, maxLength: 4 })
  .map((segments) => {
    const params: string[] = [];
    const parts = segments.map((s, i) => {
      if ("param" in s) {
        // Deduplicate placeholder names within a single path.
        const name = params.includes(s.param) ? `${s.param}${i}` : s.param;
        params.push(name);
        return `{${name}}`;
      }
      return s.literal;
    });
    return { path: `/${parts.join("/")}`, pathParams: params };
  });

const METHODS = ["get", "post", "put", "delete"] as const;

/** A full, valid OpenAPI 3.0 document. */
const docArb = fc
  .array(
    fc.record({
      built: pathArb,
      methods: fc.uniqueArray(fc.constantFrom(...METHODS), {
        minLength: 1,
        maxLength: 4,
      }),
      opId: fc.option(token, { nil: undefined }),
      queryParam: fc.option(fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/), {
        nil: undefined,
      }),
    }),
    { minLength: 1, maxLength: 6 },
  )
  .map((specs) => {
    const paths: Record<string, Record<string, unknown>> = {};
    let idSeed = 0;
    for (const { built, methods, opId, queryParam } of specs) {
      // Avoid duplicate path keys.
      const key = paths[built.path] ? `${built.path}/x${idSeed}` : built.path;
      const extraParam =
        key === built.path ? built.pathParams : [...built.pathParams];
      const item: Record<string, unknown> = {};
      for (const method of methods) {
        idSeed += 1;
        const parameters = [
          ...extraParam.map((name) => ({
            name,
            in: "path",
            required: true,
            schema: { type: "string" },
          })),
          ...(queryParam
            ? [{ name: queryParam, in: "query", schema: { type: "string" } }]
            : []),
        ];
        item[method] = {
          ...(opId ? { operationId: `${opId}_${idSeed}` } : {}),
          parameters,
          responses: { "200": { description: "ok" } },
        };
      }
      paths[key] = item;
    }
    return {
      openapi: "3.0.0",
      info: { title: "Generated", version: "1.0.0" },
      paths,
    };
  });

const NAME_RE = /^[A-Za-z0-9_-]+$/;

describe("openApiSource — parser invariants (property-based)", () => {
  it("never throws and produces MCP-safe, unique tool names", async () => {
    await fc.assert(
      fc.asyncProperty(docArb, async (doc) => {
        const result = await openApiSource({ data: doc }).parse();
        // toolCount mirrors the tool list.
        expect(result.metadata.toolCount).toBe(result.tools.length);
        const seen = new Set<string>();
        for (const tool of result.tools) {
          // Names are always MCP-safe and unique.
          expect(tool.name).toMatch(NAME_RE);
          expect(seen.has(tool.name)).toBe(false);
          seen.add(tool.name);
          // Sanitization is idempotent for the emitted name.
          expect(sanitizeToolName(tool.name)).toBe(tool.name);
          // The operation binding reflects the spec.
          expect(tool.operation.protocol).toBe("http");
          if (tool.operation.protocol === "http") {
            expect(["GET", "POST", "PUT", "DELETE"]).toContain(
              tool.operation.method,
            );
            expect(tool.operation.path.startsWith("/")).toBe(true);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("marks every path parameter as required in the input schema", async () => {
    await fc.assert(
      fc.asyncProperty(docArb, async (doc) => {
        const result = await openApiSource({ data: doc }).parse();
        for (const tool of result.tools) {
          const pathParams = tool.parameters.filter(
            (p) => p.location === "path",
          );
          for (const p of pathParams) {
            expect(p.required).toBe(true);
            const schema = tool.inputSchema;
            if (typeof schema === "object" && Array.isArray(schema.required)) {
              expect(schema.required).toContain(p.name);
            }
          }
        }
      }),
      { numRuns: 150 },
    );
  });

  it("always generates a server that passes the security audit", async () => {
    await fc.assert(
      fc.asyncProperty(docArb, async (doc) => {
        const result = await openApiSource({ data: doc }).parse();
        const project = await generateProject(result, { transport: "http" });
        const audit = auditGeneratedProject(project.files);
        const high = audit.findings.filter((f) => f.severity === "high");
        expect(high, JSON.stringify(high)).toEqual([]);
        // Every planned tool produced a module file.
        for (const t of project.plan.tools) {
          expect(project.files.has(`src/tools/${t.toolName}.ts`)).toBe(true);
        }
      }),
      { numRuns: 40 },
    );
  });
});
