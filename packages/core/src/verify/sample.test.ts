import { describe, expect, it } from "vitest";
import { openApiSource } from "../parsers/openapi.js";
import { fileURLToPath } from "node:url";
import { sampleFromSchema, sampleToolInput } from "./sample.js";

describe("sampleFromSchema", () => {
  it("honors example / default / const / enum before deriving from type", () => {
    expect(sampleFromSchema({ type: "string", example: "hi" })).toBe("hi");
    expect(sampleFromSchema({ type: "number", default: 7 })).toBe(7);
    expect(sampleFromSchema({ const: "fixed" })).toBe("fixed");
    expect(sampleFromSchema({ enum: ["a", "b"] })).toBe("a");
  });

  it("derives minimal values per primitive type", () => {
    expect(sampleFromSchema({ type: "string" })).toBe("example");
    expect(sampleFromSchema({ type: "integer" })).toBe(1);
    expect(sampleFromSchema({ type: "integer", minimum: 5 })).toBe(5);
    expect(sampleFromSchema({ type: "boolean" })).toBe(true);
    expect(sampleFromSchema({ type: "string", format: "date" })).toBe(
      "2024-01-01",
    );
  });

  it("samples required object properties only unless told otherwise", () => {
    const schema = {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" }, tag: { type: "string" } },
    };
    expect(sampleFromSchema(schema)).toEqual({ name: "example" });
    expect(sampleFromSchema(schema, { includeOptional: true })).toEqual({
      name: "example",
      tag: "example",
    });
  });

  it("samples arrays with a single representative element", () => {
    expect(
      sampleFromSchema({ type: "array", items: { type: "integer" } }),
    ).toEqual([1]);
    // No items → empty array.
    expect(sampleFromSchema({ type: "array" })).toEqual([]);
  });

  it("tunes strings to common formats", () => {
    expect(sampleFromSchema({ type: "string", format: "date-time" })).toBe(
      "2024-01-01T00:00:00Z",
    );
    expect(sampleFromSchema({ type: "string", format: "email" })).toBe(
      "user@example.com",
    );
    expect(sampleFromSchema({ type: "string", format: "uri" })).toBe(
      "https://example.com",
    );
    expect(sampleFromSchema({ type: "string", format: "uuid" })).toBe(
      "00000000-0000-0000-0000-000000000000",
    );
    // Long minLength → padded string of the right length.
    expect(sampleFromSchema({ type: "string", minLength: 10 })).toBe(
      "x".repeat(10),
    );
  });

  it("handles null, boolean whole-schemas, and untyped fallback", () => {
    expect(sampleFromSchema({ type: "null" })).toBeNull();
    expect(sampleFromSchema(true)).toEqual({});
    expect(sampleFromSchema(false)).toBeUndefined();
    expect(sampleFromSchema({})).toBe("example");
  });

  it("samples the first branch of composition keywords", () => {
    expect(sampleFromSchema({ allOf: [{ type: "integer" }] })).toBe(1);
    expect(sampleFromSchema({ oneOf: [{ type: "boolean" }] })).toBe(true);
    expect(sampleFromSchema({ anyOf: [{ type: "string" }] })).toBe("example");
  });

  it("treats a nullable type array by sampling the non-null type", () => {
    expect(sampleFromSchema({ type: ["null", "integer"], minimum: 3 })).toBe(3);
  });
});

const petstore = fileURLToPath(
  new URL("../../test/fixtures/openapi/petstore.yaml", import.meta.url),
);

describe("sampleToolInput (petstore)", () => {
  it("includes required path params and a required body, omits optionals", async () => {
    const { tools } = await openApiSource({ path: petstore }).parse();
    const byName = new Map(tools.map((t) => [t.name, t]));

    // listPets has only optional query params → empty input.
    expect(sampleToolInput(byName.get("listPets")!)).toEqual({});
    // showPetById requires the petId path param.
    expect(sampleToolInput(byName.get("showPetById")!)).toEqual({
      petId: "example",
    });
    // createPet requires a body shaped from NewPet (name required).
    expect(sampleToolInput(byName.get("createPet")!)).toEqual({
      body: { name: "example" },
    });
  });
});
