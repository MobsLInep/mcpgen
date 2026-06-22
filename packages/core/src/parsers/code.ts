/**
 * @fileoverview Code repository parser (Express / Fastify, TypeScript).
 *
 * Statically analyzes a local directory with ts-morph and emits best-effort
 * {@link ToolCandidate}s for detected HTTP route registrations. Because this is
 * heuristic AST matching — not execution — every candidate is marked
 * low-confidence and carries a `file:line` provenance so a human can verify it.
 */
import { relative } from "node:path";
import { Node, Project, type CallExpression } from "ts-morph";
import {
  type HttpMethod,
  type JsonSchema,
  type JsonSchemaObject,
  type ParameterCandidate,
  type ParseResult,
  type Source,
  type SourceMetadata,
  type ToolCandidate,
  sanitizeToolName,
  uniqueName,
} from "../ir.js";

/** Input accepted by {@link codeSource}: a path to the repo/directory. */
export type CodeInput = string;

/** HTTP-ish method names Express/Fastify expose as router methods. */
const ROUTER_METHODS = new Map<string, HttpMethod>([
  ["get", "GET"],
  ["post", "POST"],
  ["put", "PUT"],
  ["delete", "DELETE"],
  ["patch", "PATCH"],
  ["options", "OPTIONS"],
  ["head", "HEAD"],
]);

const WRITE_METHODS = new Set<HttpMethod>(["POST", "PUT", "PATCH"]);

/** Object identifiers that plausibly hold an Express app/router or Fastify instance. */
const ROUTER_NAME_RE = /^(app|router|routes?|fastify|server|api|r)$/i;
const ROUTER_NAME_LOOSE_RE = /(app|router|route|fastify|server)/i;

interface DetectedRoute {
  method: HttpMethod;
  path: string;
  file: string;
  line: number;
  framework: "express" | "fastify" | "unknown";
  warnings: string[];
}

/** Extract a string value from a literal node, if it is one. */
function literalString(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (
    Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node)
  ) {
    return node.getLiteralText();
  }
  return undefined;
}

/** The trailing identifier of a callee object, e.g. `api` in `this.api.get`. */
function objectName(call: CallExpression): string | undefined {
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return undefined;
  const obj = expr.getExpression();
  if (Node.isIdentifier(obj)) return obj.getText();
  if (Node.isPropertyAccessExpression(obj)) return obj.getName();
  return undefined;
}

/** Detect `app.get("/x", handler)` style registrations. */
function matchMethodCall(
  call: CallExpression,
  fileImports: Set<string>,
): DetectedRoute | undefined {
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return undefined;
  const methodName = expr.getName().toLowerCase();
  const method = ROUTER_METHODS.get(methodName);
  if (!method) return undefined;

  const objName = objectName(call);
  if (!objName) return undefined;
  const strongName = ROUTER_NAME_RE.test(objName);
  const looseName = ROUTER_NAME_LOOSE_RE.test(objName);
  if (!strongName && !looseName) return undefined;

  const path = literalString(call.getArguments()[0]);
  if (path === undefined || !path.startsWith("/")) return undefined;

  const framework: DetectedRoute["framework"] = fileImports.has("fastify")
    ? "fastify"
    : fileImports.has("express")
      ? "express"
      : "unknown";

  return {
    method,
    path,
    file: "",
    line: call.getStartLineNumber(),
    framework,
    warnings: strongName ? [] : [`inferred from receiver "${objName}"`],
  };
}

/** Detect Fastify's `fastify.route({ method, url })` object form. */
function matchRouteObject(
  call: CallExpression,
  fileImports: Set<string>,
): DetectedRoute[] {
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return [];
  if (expr.getName() !== "route") return [];
  const objName = objectName(call);
  if (!objName || !ROUTER_NAME_LOOSE_RE.test(objName)) return [];

  const arg = call.getArguments()[0];
  if (!arg || !Node.isObjectLiteralExpression(arg)) return [];

  const urlProp = arg.getProperty("url");
  let url: string | undefined;
  if (urlProp && Node.isPropertyAssignment(urlProp)) {
    url = literalString(urlProp.getInitializer());
  }
  if (url === undefined) return [];

  const methodProp = arg.getProperty("method");
  const methods: HttpMethod[] = [];
  if (methodProp && Node.isPropertyAssignment(methodProp)) {
    const init = methodProp.getInitializer();
    const single = literalString(init);
    if (single) {
      const m = ROUTER_METHODS.get(single.toLowerCase());
      if (m) methods.push(m);
    } else if (init && Node.isArrayLiteralExpression(init)) {
      for (const el of init.getElements()) {
        const m = ROUTER_METHODS.get((literalString(el) ?? "").toLowerCase());
        if (m) methods.push(m);
      }
    }
  }
  if (methods.length === 0) return [];

  const framework: DetectedRoute["framework"] = fileImports.has("fastify")
    ? "fastify"
    : "unknown";

  return methods.map((method) => ({
    method,
    path: url as string,
    file: "",
    line: call.getStartLineNumber(),
    framework,
    warnings: [],
  }));
}

/** Pull `:param` tokens out of an Express/Fastify path template. */
function pathParams(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1] as string);
}

function buildInputSchema(params: ParameterCandidate[]): JsonSchema {
  const properties: JsonSchemaObject = {};
  const required: string[] = [];
  for (const p of params) {
    properties[p.name] = p.schema;
    if (p.required) required.push(p.name);
  }
  const schema: JsonSchemaObject = { type: "object", properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

function routeToTool(route: DetectedRoute, used: Set<string>): ToolCandidate {
  const params: ParameterCandidate[] = pathParams(route.path).map((name) => ({
    name,
    location: "path",
    required: true,
    schema: { type: "string" },
  }));
  const warnings = [...route.warnings];
  if (WRITE_METHODS.has(route.method)) {
    params.push({
      name: "body",
      location: "body",
      required: false,
      schema: { type: "object" },
      description: "request body (shape not statically inferable)",
    });
    warnings.push("request body shape inferred as opaque object");
  }

  const name = uniqueName(
    sanitizeToolName(`${route.method.toLowerCase()}_${route.path}`),
    used,
  );
  // Best-effort static guess: a touch higher when the framework is confirmed
  // via imports, but always low-confidence by design.
  const confidence = route.framework === "unknown" ? 0.45 : 0.6;

  return {
    name,
    description: `${route.method} ${route.path}`,
    operation: { protocol: "http", method: route.method, path: route.path },
    parameters: params,
    inputSchema: buildInputSchema(params.filter((p) => p.location !== "body")),
    auth: [],
    confidence,
    provenance: {
      sourceKind: "repo",
      locator: `${route.file}:${route.line}`,
      file: route.file,
      line: route.line,
    },
    warnings,
  };
}

/** Create a {@link Source} that statically scans a repo for route handlers. */
export function codeSource(dir: CodeInput): Source {
  return {
    kind: "repo",
    parse(): Promise<ParseResult> {
      const project = new Project({
        skipAddingFilesFromTsConfig: true,
        skipFileDependencyResolution: true,
        compilerOptions: { allowJs: false },
      });
      project.addSourceFilesAtPaths([
        `${dir}/**/*.ts`,
        `!${dir}/**/*.d.ts`,
        `!${dir}/**/*.test.ts`,
        `!${dir}/**/*.spec.ts`,
        `!${dir}/**/node_modules/**`,
        `!${dir}/**/dist/**`,
      ]);

      const routes: DetectedRoute[] = [];
      for (const sf of project.getSourceFiles()) {
        const fileImports = new Set<string>(
          sf.getImportDeclarations().map((d) => d.getModuleSpecifierValue()),
        );
        const relPath = relative(dir, sf.getFilePath());
        sf.forEachDescendant((node) => {
          if (!Node.isCallExpression(node)) return;
          const single = matchMethodCall(node, fileImports);
          if (single) {
            routes.push({ ...single, file: relPath });
            return;
          }
          for (const r of matchRouteObject(node, fileImports)) {
            routes.push({ ...r, file: relPath });
          }
        });
      }

      // Stable ordering: by file, then source line.
      routes.sort((a, b) =>
        a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
      );

      const used = new Set<string>();
      const tools = routes.map((r) => routeToTool(r, used));

      const frameworks = new Set(routes.map((r) => r.framework));
      const warnings: string[] = [
        "tool candidates are best-effort static guesses; verify before use",
      ];

      const metadata: SourceMetadata = {
        kind: "repo",
        title: frameworks.has("fastify")
          ? "Fastify routes"
          : frameworks.has("express")
            ? "Express routes"
            : "HTTP routes",
        toolCount: tools.length,
        location: dir,
        warnings,
      };

      return Promise.resolve({ metadata, tools });
    },
  };
}
