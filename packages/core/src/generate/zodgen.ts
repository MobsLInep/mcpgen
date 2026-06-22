/**
 * @fileoverview Deterministic JSON Schema → Zod source generation.
 *
 * Used to build the input-schema raw shape for the deterministic fallback
 * synthesizer (and to give the LLM a sane baseline). Emits Zod *source text*,
 * not Zod objects, because the output is written into generated `.ts` files.
 * The mapping is intentionally conservative — anything it can't model becomes
 * `z.unknown()` rather than guessing.
 */
import type { JsonSchema, JsonSchemaObject } from "../ir.js";

/** Escape a string for embedding in a double-quoted TS literal. */
function quote(text: string): string {
  return JSON.stringify(text);
}

function isObjectSchema(schema: JsonSchema): schema is JsonSchemaObject {
  return typeof schema === "object" && schema !== null;
}

/**
 * Convert a JSON Schema fragment to a Zod expression (as source text). Does not
 * append `.optional()` — the caller decides optionality from the `required`
 * list of the enclosing object.
 */
export function jsonSchemaToZod(schema: JsonSchema): string {
  if (!isObjectSchema(schema)) {
    // `true`/`false` whole-schema — accept anything.
    return "z.unknown()";
  }

  const enumValues = schema.enum;
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    if (enumValues.every((v) => typeof v === "string")) {
      return `z.enum([${enumValues.map((v) => quote(v as string)).join(", ")}])`;
    }
    // Mixed/literal enum — fall back to a union of literals.
    const literals = enumValues.map((v) => `z.literal(${JSON.stringify(v)})`);
    return literals.length === 1
      ? literals[0]!
      : `z.union([${literals.join(", ")}])`;
  }

  const type = schema.type;
  const resolved = Array.isArray(type) ? type.find((t) => t !== "null") : type;

  switch (resolved) {
    case "string":
      return "z.string()";
    case "integer":
      return "z.number().int()";
    case "number":
      return "z.number()";
    case "boolean":
      return "z.boolean()";
    case "array": {
      const items = schema.items as JsonSchema | undefined;
      const inner = items ? jsonSchemaToZod(items) : "z.unknown()";
      return `z.array(${inner})`;
    }
    case "object":
      return objectSchemaToZod(schema);
    default:
      // No usable `type`: if it has properties, treat as object; else unknown.
      return schema.properties ? objectSchemaToZod(schema) : "z.unknown()";
  }
}

/** Convert an object schema to a `z.object({...})` (or `z.record`) expression. */
function objectSchemaToZod(schema: JsonSchemaObject): string {
  const properties = schema.properties as
    | Record<string, JsonSchema>
    | undefined;
  if (!properties || Object.keys(properties).length === 0) {
    return "z.record(z.string(), z.unknown())";
  }
  const required = new Set(
    Array.isArray(schema.required) ? (schema.required as string[]) : [],
  );
  const entries = Object.entries(properties).map(([key, propSchema]) => {
    let expr = jsonSchemaToZod(propSchema);
    const description = isObjectSchema(propSchema)
      ? (propSchema.description as string | undefined)
      : undefined;
    if (description) expr += `.describe(${quote(description)})`;
    if (!required.has(key)) expr += ".optional()";
    return `    ${propertyKey(key)}: ${expr},`;
  });
  return `z.object({\n${entries.join("\n")}\n  })`;
}

/** Emit a safe object-literal key (bare identifier or quoted string). */
export function propertyKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : quote(name);
}
