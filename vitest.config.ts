import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Alias workspace packages to their TypeScript source so `pnpm test` runs
// without a prior build (package "exports" otherwise point at dist/).
export default defineConfig({
  resolve: {
    alias: {
      "@mcpgen/core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url),
      ),
      "@mcpgen/templates": fileURLToPath(
        new URL("./packages/templates/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["packages/**/src/**/*.test.ts", "apps/**/src/**/*.test.ts"],
    environment: "node",
    // Some property-based / golden suites generate and verify many projects.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json-summary", "html"],
      reportsDirectory: "./coverage",
      // Coverage is measured on the generation engine + verification loop —
      // the code Phase 7 hardens. Pure scaffolding, templates, type-only
      // modules, tests and fixtures are excluded so the number reflects logic.
      include: ["packages/core/src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/test/**",
        "packages/core/src/index.ts", // re-export barrel
        "packages/core/src/verify/index.ts", // re-export barrel
        "packages/core/src/ir.ts", // type definitions + tiny helpers (covered indirectly)
      ],
      // Phase 7 target: a meaningful bar on the engine + verification loop.
      thresholds: {
        "packages/core/src/generate/**/*.ts": {
          statements: 85,
          branches: 80,
          functions: 85,
          lines: 85,
        },
        "packages/core/src/verify/**/*.ts": {
          statements: 85,
          branches: 80,
          functions: 85,
          lines: 85,
        },
      },
    },
  },
});
