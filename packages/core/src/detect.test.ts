import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectSource, UnknownSourceError } from "./detect.js";

const fixture = (rel: string): string =>
  fileURLToPath(new URL(`../test/fixtures/${rel}`, import.meta.url));

describe("detectSource", () => {
  it("classifies an OpenAPI YAML spec", async () => {
    const source = await detectSource(fixture("openapi/petstore.yaml"));
    expect(source.kind).toBe("openapi");
    const { tools } = await source.parse();
    expect(tools).toHaveLength(5);
  });

  it("classifies a GraphQL SDL schema", async () => {
    const source = await detectSource(fixture("graphql/schema.graphql"));
    expect(source.kind).toBe("graphql");
  });

  it("treats a directory as a code repo", async () => {
    const source = await detectSource(fixture("repo/express"));
    expect(source.kind).toBe("repo");
  });

  it("rejects an unrecognizable file", async () => {
    await expect(
      detectSource(fixture("misc/notes.txt")),
    ).rejects.toBeInstanceOf(UnknownSourceError);
  });
});
