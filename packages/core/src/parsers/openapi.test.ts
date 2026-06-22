import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openApiSource, OpenApiValidationError } from "./openapi.js";

const fixture = (name: string): string =>
  fileURLToPath(
    new URL(`../../test/fixtures/openapi/${name}`, import.meta.url),
  );

describe("openApiSource", () => {
  it("parses the petstore fixture into the expected tools", async () => {
    const { metadata, tools } = await openApiSource({
      path: fixture("petstore.yaml"),
    }).parse();

    expect(metadata.kind).toBe("openapi");
    expect(metadata.title).toBe("Swagger Petstore");
    expect(metadata.version).toBe("1.0.0");
    expect(metadata.specVersion).toBe("3.0.3");
    expect(metadata.servers).toEqual(["https://api.petstore.example/v1"]);

    // 5 operations across the two paths.
    expect(tools).toHaveLength(5);
    expect(metadata.toolCount).toBe(5);
    expect(tools.map((t) => t.name).sort()).toEqual([
      "createPet",
      "deletePet",
      "listPets",
      "showPetById",
      "updatePet",
    ]);
  });

  it("normalizes a sample tool (createPet) end to end", async () => {
    const { tools } = await openApiSource({
      path: fixture("petstore.yaml"),
    }).parse();
    const createPet = tools.find((t) => t.name === "createPet");
    if (!createPet) throw new Error("createPet not found");

    expect(createPet.operation).toEqual({
      protocol: "http",
      method: "POST",
      path: "/pets",
    });
    expect(createPet.description).toBe("Create a pet");
    expect(createPet.confidence).toBe(0.99);
    expect(createPet.provenance).toMatchObject({
      sourceKind: "openapi",
      locator: "POST /pets",
      identifier: "createPet",
    });

    // Request body is captured as a `body` parameter + nested in inputSchema.
    const body = createPet.parameters.find((p) => p.name === "body");
    expect(body?.location).toBe("body");
    expect(body?.required).toBe(true);
    // $ref was dereferenced to a concrete object schema.
    expect(body?.schema).toMatchObject({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    });

    // Inherits the root apiKey security requirement.
    expect(createPet.auth).toEqual([
      { scheme: "apiKey", name: "X-API-Key", location: "header" },
    ]);

    // Response schema captured.
    expect(createPet.outputSchema).toMatchObject({
      type: "object",
      properties: { id: { type: "integer" } },
    });
  });

  it("captures path parameters and per-operation security overrides", async () => {
    const { tools } = await openApiSource({
      path: fixture("petstore.yaml"),
    }).parse();

    const showPet = tools.find((t) => t.name === "showPetById");
    expect(showPet?.parameters).toEqual([
      {
        name: "petId",
        location: "path",
        required: true,
        schema: { type: "string" },
        description: "The id of the pet",
      },
    ]);
    // `security: []` override makes this operation public.
    expect(showPet?.auth).toEqual([]);

    const listPets = tools.find((t) => t.name === "listPets");
    expect(listPets?.auth).toEqual([]);
    expect(listPets?.parameters.map((p) => p.name)).toEqual(["limit", "tags"]);
  });

  it("accepts in-memory content and parsed objects", async () => {
    const content = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Inline", version: "0.1.0" },
      paths: {
        "/ping": {
          get: {
            operationId: "ping",
            responses: { "200": { description: "ok" } },
          },
        },
      },
    });
    const fromContent = await openApiSource({ content }).parse();
    expect(fromContent.tools).toHaveLength(1);
    expect(fromContent.tools[0]?.name).toBe("ping");

    const fromData = await openApiSource({
      data: JSON.parse(content),
    }).parse();
    expect(fromData.tools[0]?.operation).toEqual({
      protocol: "http",
      method: "GET",
      path: "/ping",
    });
  });

  it("throws a validation error on an invalid spec", async () => {
    await expect(
      openApiSource({ data: { openapi: "3.0.0", paths: {} } }).parse(),
    ).rejects.toBeInstanceOf(OpenApiValidationError);
  });
});
