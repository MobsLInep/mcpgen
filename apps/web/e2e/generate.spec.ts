import { expect, test } from "@playwright/test";

/**
 * The full happy path against the deterministic API runner: load a sample spec,
 * detect tools, tweak the selection, configure with verification on, generate,
 * watch the streamed stages complete, and reach a downloadable result.
 */
test("generate an MCP server end to end", async ({ page }) => {
  await page.goto("/");

  // Landing copy is present.
  await expect(
    page.getByRole("heading", { name: /working MCP server/i }),
  ).toBeVisible();

  // --- Source: load the petstore sample, then detect ---------------------
  await page.getByRole("button", { name: "petstore.openapi.json" }).click();
  await expect(page.getByTestId("source-input")).not.toHaveValue("");
  await page.getByTestId("detect-button").click();

  // --- Review: tools detected; deselect one then continue ----------------
  await expect(page.getByText(/operations selected/i)).toBeVisible();
  await expect(page.getByText("getPetById")).toBeVisible();
  // Drop the third tool via its toggle.
  await page.getByRole("switch", { name: /Include getPetById/i }).click();
  await page.getByTestId("to-configure").click();

  // --- Configure: turn verification on, then generate --------------------
  await page
    .getByRole("switch", { name: "Verify the generated server" })
    .click();
  await page.getByTestId("generate-button").click();

  // --- Streaming progress: generate + verify stages appear ---------------
  await expect(page.getByTestId("progress-stream")).toBeVisible();
  await expect(page.getByText("Install deps")).toBeVisible();

  // --- Result: server is ready, download + copy are offered --------------
  const result = page.getByTestId("result-panel");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/verified/i)).toBeVisible();
  await expect(page.getByTestId("download-zip")).toBeVisible();
  await expect(page.getByTestId("copy-config")).toBeVisible();

  // The file viewer shows generated source.
  await expect(
    page.getByRole("button", { name: /src\/server\.ts/ }),
  ).toBeVisible();
});
