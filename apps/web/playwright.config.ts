import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the generator happy path. Two web servers are started:
 *   - the API in deterministic mode (`MCPGEN_FAKE=1`) so runs are hermetic and
 *     need no LLM, network install, or real toolchain;
 *   - the Next.js dev server, pointed at that API.
 *
 * Ports are offset from the usual dev ports (3100/3101) so a running `pnpm dev`
 * doesn't clash with the test run.
 */
const WEB_PORT = 3100;
const API_PORT = 3101;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm exec tsx src/index.ts",
      cwd: "../api",
      env: {
        MCPGEN_FAKE: "1",
        MCPGEN_FAKE_STEP_MS: "20",
        PORT: String(API_PORT),
      },
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `pnpm exec next dev -p ${WEB_PORT}`,
      cwd: ".",
      env: { NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}` },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
