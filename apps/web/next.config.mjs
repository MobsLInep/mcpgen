import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server (.next/standalone) so the Docker image needs
  // only Node + the traced files — no pnpm install at runtime.
  output: "standalone",
  // The repo root, so file tracing follows workspace links correctly.
  outputFileTracingRoot: join(here, "..", ".."),
};

export default nextConfig;
