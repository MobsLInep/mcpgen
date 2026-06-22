import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openApiSource } from "../parsers/openapi.js";
import { fallbackPlan } from "../generate/engine.js";
import { openApiExampleMock } from "./mock.js";

const petstore = fileURLToPath(
  new URL("../../test/fixtures/openapi/petstore.yaml", import.meta.url),
);

describe("openApiExampleMock", () => {
  it("serves canned responses derived from the IR output schemas", async () => {
    const result = await openApiSource({ path: petstore }).parse();
    const plan = fallbackPlan(result);
    const upstream = await openApiExampleMock(result, plan).start();
    try {
      // GET /pets → 200 array of Pet sampled from the output schema.
      const list = await fetch(`${upstream.url}/pets`);
      expect(list.status).toBe(200);
      const pets = (await list.json()) as Array<Record<string, unknown>>;
      expect(Array.isArray(pets)).toBe(true);
      expect(pets[0]).toMatchObject({ id: expect.anything(), name: expect.any(String) });

      // GET /pets/{petId} → 200 single Pet (path param matched).
      const one = await fetch(`${upstream.url}/pets/123`);
      expect(one.status).toBe(200);
      expect((await one.json()) as Record<string, unknown>).toHaveProperty(
        "name",
      );

      // POST /pets → 201 Created.
      const created = await fetch(`${upstream.url}/pets`, { method: "POST" });
      expect(created.status).toBe(201);

      // DELETE /pets/{petId} → 204 No Content.
      const deleted = await fetch(`${upstream.url}/pets/9`, {
        method: "DELETE",
      });
      expect(deleted.status).toBe(204);
    } finally {
      await upstream.close();
    }
  });

  it("never hits the network: unmatched routes still return a benign 200", async () => {
    const result = await openApiSource({ path: petstore }).parse();
    const upstream = await openApiExampleMock(result, fallbackPlan(result)).start();
    try {
      const res = await fetch(`${upstream.url}/not/a/real/route`);
      expect(res.status).toBe(200);
      expect((await res.json()) as Record<string, unknown>).toMatchObject({
        mock: true,
      });
    } finally {
      await upstream.close();
    }
  });
});
