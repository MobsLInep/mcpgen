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
  },
});
