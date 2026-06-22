/**
 * @fileoverview Docker smoke test — proves a *generated* server's container
 * actually builds and boots. It generates the petstore project deterministically
 * (no LLM), writes it to a temp dir, `docker build`s the image, runs it with the
 * http transport, and polls `/healthz` until it answers.
 *
 * This is heavy (a real image build pulls the base image + installs deps) and
 * needs a working Docker daemon, so it is **opt-in**: it only runs when
 * `MCPGEN_DOCKER_SMOKE=1`. Normal `pnpm test` / CI skips it.
 *
 *   MCPGEN_DOCKER_SMOKE=1 pnpm vitest run docker-smoke
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { openApiSource } from "../parsers/openapi.js";
import { generateProject, writeProject } from "../generate/engine.js";

const ENABLED = process.env.MCPGEN_DOCKER_SMOKE === "1";

const openapiFixture = fileURLToPath(
  new URL("../../test/fixtures/openapi/petstore.yaml", import.meta.url),
);

/** A unique-ish image tag + host port for this run. */
const tag = `mcpgen-smoke-${Date.now()}`;
const hostPort = 3000 + (Date.now() % 2000);
let workdir: string | undefined;

function docker(args: string[], timeoutMs = 600_000): string {
  return execFileSync("docker", args, {
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

afterAll(() => {
  if (!ENABLED) return;
  // Best-effort teardown; ignore errors if the resources never came up.
  spawnSync("docker", ["rm", "-f", tag], { stdio: "ignore" });
  spawnSync("docker", ["rmi", "-f", tag], { stdio: "ignore" });
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

describe.skipIf(!ENABLED)("generated server Docker image (smoke)", () => {
  it(
    "builds the image and answers /healthz over the http transport",
    async () => {
      // 1. Generate the petstore server deterministically and write it out.
      const result = await openApiSource({ path: openapiFixture }).parse();
      const project = await generateProject(result, { transport: "http" });
      workdir = mkdtempSync(join(tmpdir(), "mcpgen-docker-"));
      writeProject(project, workdir);

      // 2. Build the image from the generated Dockerfile.
      docker(["build", "-t", tag, workdir]);

      // 3. Run it with the http transport against a stub upstream.
      docker([
        "run",
        "-d",
        "--name",
        tag,
        "-p",
        `${hostPort}:3000`,
        "-e",
        "MCPGEN_TRANSPORT=http",
        "-e",
        "MCPGEN_API_BASE_URL=http://upstream.invalid",
        tag,
      ]);

      // 4. Poll /healthz until it answers (the HEALTHCHECK gives it a moment).
      const deadline = Date.now() + 60_000;
      let ok = false;
      let body: { status?: string } = {};
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`http://localhost:${hostPort}/healthz`);
          if (res.ok) {
            body = (await res.json()) as { status?: string };
            ok = true;
            break;
          }
        } catch {
          // not up yet
        }
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (!ok) {
        // Surface container logs to make a failure debuggable.
        const logs = spawnSync("docker", ["logs", tag], {
          encoding: "utf8",
        }).stdout;
        throw new Error(`server never became healthy. logs:\n${logs}`);
      }
      expect(body.status).toBe("ok");
    },
    600_000,
  );
});
