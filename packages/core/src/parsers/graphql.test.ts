import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildSchema,
  getIntrospectionQuery,
  graphqlSync,
  printSchema,
} from "graphql";
import { describe, expect, it } from "vitest";
import { graphqlSource } from "./graphql.js";

const sdl = readFileSync(
  fileURLToPath(
    new URL("../../test/fixtures/graphql/schema.graphql", import.meta.url),
  ),
  "utf8",
);

describe("graphqlSource", () => {
  it("turns query and mutation fields into tools", async () => {
    const { metadata, tools } = await graphqlSource({ content: sdl }).parse();

    expect(metadata.kind).toBe("graphql");
    expect(tools).toHaveLength(4);
    expect(metadata.toolCount).toBe(4);
    expect(tools.map((t) => t.name).sort()).toEqual([
      "createPost",
      "deletePost",
      "posts",
      "user",
    ]);
  });

  it("maps arguments and return types to JSON schema", async () => {
    const { tools } = await graphqlSource({ content: sdl }).parse();

    const user = tools.find((t) => t.name === "user");
    expect(user?.operation).toEqual({
      protocol: "graphql",
      operation: "query",
      field: "user",
    });
    expect(user?.description).toBe("Fetch a single user by id.");
    expect(user?.parameters).toEqual([
      {
        name: "id",
        location: "arg",
        required: true,
        schema: { type: "string" },
      },
    ]);

    // Enum argument becomes a string enum; non-required arg is optional.
    const posts = tools.find((t) => t.name === "posts");
    const statusArg = posts?.parameters.find((p) => p.name === "status");
    expect(statusArg?.required).toBe(false);
    expect(statusArg?.schema).toEqual({
      type: "string",
      enum: ["DRAFT", "PUBLISHED"],
    });
    expect(posts?.outputSchema).toMatchObject({ type: "array" });

    // Input object argument expands into an object schema with required fields.
    const createPost = tools.find((t) => t.name === "createPost");
    expect(createPost?.operation).toMatchObject({ operation: "mutation" });
    const input = createPost?.parameters.find((p) => p.name === "input");
    expect(input?.required).toBe(true);
    expect(input?.schema).toMatchObject({
      type: "object",
      title: "CreatePostInput",
      required: expect.arrayContaining(["title", "body", "authorId"]),
    });
  });

  it("accepts an introspection JSON result", async () => {
    const schema = buildSchema(sdl);
    const result = graphqlSync({ schema, source: getIntrospectionQuery() });
    const introspectionJson = JSON.stringify(result);

    const { tools } = await graphqlSource({
      content: introspectionJson,
    }).parse();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "createPost",
      "deletePost",
      "posts",
      "user",
    ]);

    // Same result whether the parser builds from SDL or introspection.
    const fromSdl = await graphqlSource({
      content: printSchema(schema),
    }).parse();
    expect(fromSdl.tools).toHaveLength(tools.length);
  });
});
