/**
 * Unit tests for the repair stage: prompt construction (with error truncation),
 * patch validation, and path overriding.
 */
import { describe, expect, it } from "vitest";
import type { LlmClient, LlmRequest } from "../generate/llm.js";
import { repairFile, type RepairRequest } from "./repair.js";

const baseRequest: RepairRequest = {
  stage: "build",
  filePath: "src/tools/foo.ts",
  fileContent: "export const x = 1;",
  errorOutput: "src/tools/foo.ts(1,1): error TS1005",
};

/** A client that records the request and replies with `text`. */
function clientReturning(text: string): {
  client: LlmClient;
  last: () => LlmRequest;
} {
  let captured: LlmRequest | undefined;
  const client: LlmClient = {
    model: "m",
    complete: (request) => {
      captured = request;
      return Promise.resolve({ text });
    },
  };
  return { client, last: () => captured! };
}

describe("repairFile", () => {
  it("returns a validated patch and forces our own path", async () => {
    const { client, last } = clientReturning(
      JSON.stringify({
        path: "anything-else.ts",
        content: "export const x = 2;",
      }),
    );
    const patch = await repairFile(client, baseRequest);
    // We trust our own path over the model's.
    expect(patch.path).toBe("src/tools/foo.ts");
    expect(patch.content).toBe("export const x = 2;");
    // The request is tagged for fixture routing.
    expect(last().tag).toBe("repair:src/tools/foo.ts");
  });

  it("truncates a very long error output in the prompt", async () => {
    const { client, last } = clientReturning(
      JSON.stringify({ path: "x", content: "y" }),
    );
    const huge = "E".repeat(8000);
    await repairFile(client, { ...baseRequest, errorOutput: huge });
    const message = last().messages[0]!.content;
    expect(message).toContain("[...truncated...]");
    expect(message.length).toBeLessThan(8000);
  });

  it("handles empty error output", async () => {
    const { client, last } = clientReturning(
      JSON.stringify({ path: "x", content: "y" }),
    );
    await repairFile(client, { ...baseRequest, errorOutput: "   " });
    expect(last().messages[0]!.content).toContain("(no output captured)");
  });

  it("throws on malformed JSON", async () => {
    const { client } = clientReturning("not json at all");
    await expect(repairFile(client, baseRequest)).rejects.toThrow();
  });

  it("throws when the patch fails schema validation (empty content)", async () => {
    const { client } = clientReturning(
      JSON.stringify({ path: "x", content: "" }),
    );
    await expect(repairFile(client, baseRequest)).rejects.toThrow();
  });
});
