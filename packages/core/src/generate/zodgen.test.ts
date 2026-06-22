/**
 * Unit tests for the JSON Schema → Zod source generator. These pin the mapping
 * for every branch and confirm hostile property names are emitted as quoted
 * keys (never bare identifiers that could break the generated object literal).
 */
import { describe, expect, it } from "vitest";
import type { JsonSchema } from "../ir.js";
import { jsonSchemaToZod, propertyKey } from "./zodgen.js";

describe("jsonSchemaToZod — scalars", () => {
  it("maps primitive types", () => {
    expect(jsonSchemaToZod({ type: "string" })).toBe("z.string()");
    expect(jsonSchemaToZod({ type: "integer" })).toBe("z.number().int()");
    expect(jsonSchemaToZod({ type: "number" })).toBe("z.number()");
    expect(jsonSchemaToZod({ type: "boolean" })).toBe("z.boolean()");
  });

  it("treats a boolean whole-schema as unknown", () => {
    expect(jsonSchemaToZod(true as JsonSchema)).toBe("z.unknown()");
    expect(jsonSchemaToZod(false as JsonSchema)).toBe("z.unknown()");
  });

  it("falls back to unknown for an untyped, propertyless schema", () => {
    expect(jsonSchemaToZod({})).toBe("z.unknown()");
  });

  it("picks the first non-null type from a type array", () => {
    expect(jsonSchemaToZod({ type: ["null", "string"] })).toBe("z.string()");
  });
});

describe("jsonSchemaToZod — enums", () => {
  it("maps an all-string enum to z.enum", () => {
    expect(jsonSchemaToZod({ enum: ["a", "b"] })).toBe('z.enum(["a", "b"])');
  });

  it("maps a single mixed-literal enum to a single literal", () => {
    expect(jsonSchemaToZod({ enum: [42] })).toBe("z.literal(42)");
  });

  it("maps a multi mixed-literal enum to a union of literals", () => {
    expect(jsonSchemaToZod({ enum: [1, "two", true] })).toBe(
      'z.union([z.literal(1), z.literal("two"), z.literal(true)])',
    );
  });
});

describe("jsonSchemaToZod — composites", () => {
  it("maps arrays, recursing into items", () => {
    expect(jsonSchemaToZod({ type: "array", items: { type: "string" } })).toBe(
      "z.array(z.string())",
    );
    expect(jsonSchemaToZod({ type: "array" })).toBe("z.array(z.unknown())");
  });

  it("maps an object with properties, marking optionals and descriptions", () => {
    const out = jsonSchemaToZod({
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        note: { type: "string", description: "a note" },
      },
    });
    expect(out).toContain("id: z.string(),");
    expect(out).toContain('note: z.string().describe("a note").optional(),');
    expect(out.startsWith("z.object({")).toBe(true);
  });

  it("maps a propertyless object to a record", () => {
    expect(jsonSchemaToZod({ type: "object" })).toBe(
      "z.record(z.string(), z.unknown())",
    );
  });

  it("treats an untyped schema with properties as an object", () => {
    expect(
      jsonSchemaToZod({ properties: { a: { type: "number" } } }),
    ).toContain("z.object({");
  });
});

describe("propertyKey", () => {
  it("keeps valid identifiers bare", () => {
    expect(propertyKey("petId")).toBe("petId");
    expect(propertyKey("_x$1")).toBe("_x$1");
  });

  it("quotes hostile / non-identifier keys", () => {
    expect(propertyKey("a-b")).toBe('"a-b"');
    expect(propertyKey("x.y")).toBe('"x.y"');
    expect(propertyKey('a": z.any() } as any; //')).toBe(
      JSON.stringify('a": z.any() } as any; //'),
    );
  });
});
