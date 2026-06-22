/**
 * @fileoverview Deterministic JSON-Schema sampling for verification.
 *
 * Two jobs share one sampler:
 *  - {@link sampleToolInput} produces a safe sample argument object for a tool's
 *    smoke call (all required parameters, filled from their schemas), so the
 *    generated server can be exercised end-to-end without a human picking values.
 *  - {@link sampleFromSchema} synthesizes an example response body from a tool's
 *    output schema, which the mock upstream (see `mock.ts`) returns as a canned
 *    response — so verification never touches the real third-party API.
 *
 * Sampling is fully deterministic (no randomness): the same schema always yields
 * the same value, which keeps verification runs reproducible.
 */
import type { JsonSchema, JsonSchemaObject, ToolCandidate } from "../ir.js";

/** Options that steer how a value is sampled. */
export interface SampleOptions {
  /** Include optional object properties (default false — required only). */
  readonly includeOptional?: boolean;
}

/** A string sample tuned to common OpenAPI `format`s. */
function sampleString(schema: JsonSchemaObject): string {
  switch (schema.format) {
    case "date-time":
      return "2024-01-01T00:00:00Z";
    case "date":
      return "2024-01-01";
    case "email":
      return "user@example.com";
    case "uri":
    case "url":
      return "https://example.com";
    case "uuid":
      return "00000000-0000-0000-0000-000000000000";
    default:
      return typeof schema.minLength === "number" && schema.minLength > 7
        ? "x".repeat(schema.minLength)
        : "example";
  }
}

/** First concrete `type` for a schema that may list several. */
function primaryType(schema: JsonSchemaObject): string | undefined {
  const t = schema.type;
  if (Array.isArray(t)) return t.find((x) => x !== "null") as string | undefined;
  return typeof t === "string" ? t : undefined;
}

/**
 * Synthesize a deterministic example value for a JSON Schema. Honors `example`,
 * `default`, `const`, and `enum` when present; otherwise derives a minimal value
 * from `type`. Unknown/empty schemas fall back to a short string.
 */
export function sampleFromSchema(
  schema: JsonSchema,
  options: SampleOptions = {},
): unknown {
  if (typeof schema === "boolean") return schema ? {} : undefined;

  const s = schema;
  if ("example" in s && s.example !== undefined) return s.example;
  if ("default" in s && s.default !== undefined) return s.default;
  if ("const" in s) return s.const;
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];

  // Composition keywords: sample the first branch.
  for (const key of ["allOf", "oneOf", "anyOf"] as const) {
    const branch = s[key];
    if (Array.isArray(branch) && branch.length > 0) {
      return sampleFromSchema(branch[0] as JsonSchema, options);
    }
  }

  const type = primaryType(s) ?? (s.properties ? "object" : undefined);
  switch (type) {
    case "object": {
      const out: Record<string, unknown> = {};
      const properties = (s.properties ?? {}) as Record<string, JsonSchema>;
      const required = new Set(
        Array.isArray(s.required) ? (s.required as string[]) : [],
      );
      for (const [key, propSchema] of Object.entries(properties)) {
        if (!options.includeOptional && !required.has(key)) continue;
        out[key] = sampleFromSchema(propSchema, options);
      }
      return out;
    }
    case "array": {
      const items = s.items as JsonSchema | undefined;
      return items === undefined ? [] : [sampleFromSchema(items, options)];
    }
    case "integer":
    case "number":
      return typeof s.minimum === "number" ? s.minimum : 1;
    case "boolean":
      return true;
    case "null":
      return null;
    case "string":
      return sampleString(s);
    default:
      return "example";
  }
}

/**
 * Build a safe sample argument object for a tool's smoke call: every required
 * parameter (including a required request body), keyed by the parameter name the
 * generated handler reads. Optional parameters are omitted so the call is
 * minimal and always satisfies the registered Zod schema.
 */
export function sampleToolInput(
  candidate: ToolCandidate,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const param of candidate.parameters) {
    if (!param.required) continue;
    args[param.name] = sampleFromSchema(param.schema, { includeOptional: false });
  }
  return args;
}
