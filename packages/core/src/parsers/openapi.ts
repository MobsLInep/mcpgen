/**
 * @fileoverview OpenAPI 3.0 / 3.1 parser.
 *
 * Validates and dereferences a spec (JSON or YAML, on disk or in memory) with
 * the maintained `@readme/openapi-parser`, then turns every operation into a
 * {@link ToolCandidate}. Parameters, request bodies, responses, and security
 * requirements are normalized into the shared IR.
 */
import { dereference, validate } from "@readme/openapi-parser";
import { parse as parseYaml } from "yaml";
import {
  type AuthRequirement,
  type HttpMethod,
  type JsonSchema,
  type JsonSchemaObject,
  type ParameterCandidate,
  type ParameterLocation,
  type ParseResult,
  type Source,
  type SourceMetadata,
  type ToolCandidate,
  sanitizeToolName,
  uniqueName,
} from "../ir.js";

/** Input accepted by {@link openApiSource}. A bare string is treated as a path. */
export type OpenApiInput =
  | string
  | {
      /** Filesystem path or URL to read the spec from. */
      readonly path?: string;
      /** Raw spec content (JSON or YAML). */
      readonly content?: string;
      /** Already-parsed spec object. */
      readonly data?: unknown;
    };

const HTTP_METHODS: readonly HttpMethod[] = [
  "GET",
  "PUT",
  "POST",
  "DELETE",
  "PATCH",
  "OPTIONS",
  "HEAD",
  "TRACE",
];

/** Thrown when a spec fails OpenAPI validation. */
export class OpenApiValidationError extends Error {
  constructor(public readonly errors: readonly string[]) {
    super(`OpenAPI validation failed:\n  - ${errors.join("\n  - ")}`);
    this.name = "OpenApiValidationError";
  }
}

/** Minimal structural views of the dereferenced document (post-deref: no $ref). */
interface OpenApiDoc {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: Array<{ url?: string }>;
  paths?: Record<string, PathItem | undefined>;
  security?: SecurityRequirement[];
  components?: { securitySchemes?: Record<string, SecurityScheme | undefined> };
}
interface PathItem {
  parameters?: Parameter[];
  [method: string]: Operation | Parameter[] | undefined;
}
interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: RequestBody;
  responses?: Record<string, ResponseObject | undefined>;
  security?: SecurityRequirement[];
}
interface Parameter {
  name?: string;
  in?: string;
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
}
interface RequestBody {
  required?: boolean;
  description?: string;
  content?: Record<string, { schema?: JsonSchema } | undefined>;
}
interface ResponseObject {
  description?: string;
  content?: Record<string, { schema?: JsonSchema } | undefined>;
}
type SecurityRequirement = Record<string, string[]>;
interface SecurityScheme {
  type?: string;
  scheme?: string;
  name?: string;
  in?: string;
}

/** Pick the JSON-ish schema from a content map, preferring `application/json`. */
function schemaFromContent(
  content: Record<string, { schema?: JsonSchema } | undefined> | undefined,
): JsonSchema | undefined {
  if (!content) return undefined;
  const json = content["application/json"];
  if (json?.schema) return json.schema;
  for (const key of Object.keys(content)) {
    if (key.includes("json") && content[key]?.schema) {
      return content[key]?.schema;
    }
  }
  // Fall back to the first content type that carries a schema.
  for (const value of Object.values(content)) {
    if (value?.schema) return value.schema;
  }
  return undefined;
}

/** Choose the success response schema (2xx, else `default`). */
function successResponseSchema(
  responses: Record<string, ResponseObject | undefined> | undefined,
): JsonSchema | undefined {
  if (!responses) return undefined;
  const codes = Object.keys(responses);
  const preferred =
    codes.find((c) => c === "200" || c === "201") ??
    codes.find((c) => /^2\d\d$/.test(c)) ??
    (codes.includes("default") ? "default" : undefined);
  if (!preferred) return undefined;
  return schemaFromContent(responses[preferred]?.content);
}

function mapLocation(location: string | undefined): ParameterLocation {
  switch (location) {
    case "path":
    case "query":
    case "header":
    case "cookie":
      return location;
    default:
      return "query";
  }
}

/** Resolve a security requirement list into normalized {@link AuthRequirement}s. */
function resolveAuth(
  requirements: SecurityRequirement[] | undefined,
  schemes: Record<string, SecurityScheme | undefined> | undefined,
): AuthRequirement[] {
  if (!requirements || requirements.length === 0) return [];
  const out: AuthRequirement[] = [];
  const seen = new Set<string>();
  for (const requirement of requirements) {
    for (const [schemeName, scopes] of Object.entries(requirement)) {
      if (seen.has(schemeName)) continue;
      seen.add(schemeName);
      const def = schemes?.[schemeName];
      const auth: AuthRequirement = {
        scheme: def?.type ?? schemeName,
        ...(def?.scheme ? { httpScheme: def.scheme } : {}),
        ...(def?.name ? { name: def.name } : {}),
        ...(def?.in === "header" || def?.in === "query" || def?.in === "cookie"
          ? { location: def.in }
          : {}),
        ...(scopes.length > 0 ? { scopes } : {}),
      };
      out.push(auth);
    }
  }
  return out;
}

/** Build the combined input JSON Schema from parameters + request body. */
function buildInputSchema(
  params: ParameterCandidate[],
  body: { schema: JsonSchema; required: boolean } | undefined,
): JsonSchema {
  const properties: JsonSchemaObject = {};
  const required: string[] = [];
  for (const p of params) {
    properties[p.name] = p.schema;
    if (p.required) required.push(p.name);
  }
  if (body) {
    properties.body = body.schema;
    if (body.required) required.push("body");
  }
  const schema: JsonSchemaObject = { type: "object", properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

function buildTool(
  method: HttpMethod,
  path: string,
  op: Operation,
  pathParams: Parameter[],
  doc: OpenApiDoc,
  used: Set<string>,
): ToolCandidate {
  const warnings: string[] = [];

  // Merge path-level and operation-level parameters (operation wins on name+in).
  const mergedParams = new Map<string, Parameter>();
  for (const p of [...pathParams, ...(op.parameters ?? [])]) {
    if (p.name) mergedParams.set(`${p.in ?? "query"}:${p.name}`, p);
  }
  const parameters: ParameterCandidate[] = [...mergedParams.values()].map(
    (p) => ({
      name: p.name as string,
      location: mapLocation(p.in),
      required: p.required ?? p.in === "path",
      schema: p.schema ?? {},
      ...(p.description ? { description: p.description } : {}),
    }),
  );

  const bodySchema = schemaFromContent(op.requestBody?.content);
  const body = bodySchema
    ? { schema: bodySchema, required: op.requestBody?.required ?? false }
    : undefined;
  if (op.requestBody && !bodySchema) {
    warnings.push("request body present but no JSON schema found");
  }
  if (body) {
    parameters.push({
      name: "body",
      location: "body",
      required: body.required,
      schema: body.schema,
      ...(op.requestBody?.description
        ? { description: op.requestBody.description }
        : {}),
    });
  }

  const outputSchema = successResponseSchema(op.responses);

  // operationId is the strongest name; otherwise derive from method + path.
  const rawName = op.operationId ?? `${method.toLowerCase()}_${path}`;
  const name = uniqueName(sanitizeToolName(rawName), used);
  const confidence = op.operationId ? 0.99 : 0.9;

  const description =
    op.summary ?? op.description ?? `${method} ${path}`.trim();

  const auth = resolveAuth(
    op.security ?? doc.security,
    doc.components?.securitySchemes,
  );

  return {
    name,
    description,
    operation: { protocol: "http", method, path },
    parameters,
    inputSchema: buildInputSchema(
      parameters.filter((p) => p.location !== "body"),
      body,
    ),
    ...(outputSchema ? { outputSchema } : {}),
    auth,
    confidence,
    provenance: {
      sourceKind: "openapi",
      locator: `${method} ${path}`,
      ...(op.operationId ? { identifier: op.operationId } : {}),
    },
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/** Coerce the various input shapes into something the parser library accepts. */
function resolveInput(input: OpenApiInput): {
  forValidation: string | object;
  location?: string;
} {
  if (typeof input === "string") {
    return { forValidation: input, location: input };
  }
  if (input.data !== undefined) {
    return { forValidation: input.data as object };
  }
  if (input.content !== undefined) {
    return { forValidation: parseYaml(input.content) as object };
  }
  if (input.path !== undefined) {
    return { forValidation: input.path, location: input.path };
  }
  throw new Error("openApiSource: provide a path, content, or data");
}

/** Create a {@link Source} that parses an OpenAPI 3.0/3.1 spec. */
export function openApiSource(input: OpenApiInput): Source {
  return {
    kind: "openapi",
    async parse(): Promise<ParseResult> {
      const { forValidation, location } = resolveInput(input);

      // Validate first for clear errors, then dereference for a $ref-free doc.
      // Clone object inputs so neither call mutates the caller's object.
      // The parser accepts a path string or a document object; clone object
      // inputs per call so neither validate nor dereference mutates the caller.
      type ParserArg = Parameters<typeof validate>[0];
      const cloneFor = (): ParserArg =>
        (typeof forValidation === "string"
          ? forValidation
          : structuredClone(forValidation)) as ParserArg;

      const result = await validate(cloneFor());
      if (!result.valid) {
        throw new OpenApiValidationError(result.errors.map((e) => e.message));
      }
      const doc = (await dereference(cloneFor())) as OpenApiDoc;

      const used = new Set<string>();
      const tools: ToolCandidate[] = [];
      for (const [path, item] of Object.entries(doc.paths ?? {})) {
        if (!item) continue;
        const pathParams = item.parameters ?? [];
        for (const method of HTTP_METHODS) {
          const op = item[method.toLowerCase()];
          if (!op || Array.isArray(op)) continue;
          tools.push(buildTool(method, path, op, pathParams, doc, used));
        }
      }

      const metadata: SourceMetadata = {
        kind: "openapi",
        ...(doc.info?.title ? { title: doc.info.title } : {}),
        ...(doc.info?.version ? { version: doc.info.version } : {}),
        ...(doc.info?.description ? { description: doc.info.description } : {}),
        ...((doc.openapi ?? doc.swagger)
          ? { specVersion: doc.openapi ?? doc.swagger }
          : {}),
        ...(doc.servers && doc.servers.length > 0
          ? {
              servers: doc.servers
                .map((s) => s.url)
                .filter((u): u is string => Boolean(u)),
            }
          : {}),
        toolCount: tools.length,
        ...(location ? { location } : {}),
      };

      return { metadata, tools };
    },
  };
}
