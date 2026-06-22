import { describe, expect, it } from "vitest";
import { runDoctor } from "./doctor.js";

const okDocker = async () => ({
  available: true,
  version: "Docker version 27.0",
});
const noDocker = async () => ({ available: false });

describe("runDoctor", () => {
  it("passes when Node is new enough, key present, docker available", async () => {
    const report = await runDoctor({
      nodeVersion: "v20.11.0",
      env: { ANTHROPIC_API_KEY: "sk-ant-test" },
      dockerProbe: okDocker,
    });
    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => c.status)).toEqual(["ok", "ok", "ok"]);
  });

  it("fails hard on an unsupported Node version", async () => {
    const report = await runDoctor({
      nodeVersion: "v18.19.0",
      env: {},
      dockerProbe: okDocker,
    });
    const node = report.checks.find((c) => c.id === "node")!;
    expect(node.status).toBe("fail");
    expect(node.fix).toMatch(/upgrade/i);
    expect(report.ok).toBe(false);
  });

  it("warns (not fails) when the key and docker are missing", async () => {
    const report = await runDoctor({
      nodeVersion: "v22.0.0",
      env: {},
      dockerProbe: noDocker,
    });
    expect(report.ok).toBe(true); // warnings never block
    const key = report.checks.find((c) => c.id === "anthropic-key")!;
    const docker = report.checks.find((c) => c.id === "docker")!;
    expect(key.status).toBe("warn");
    expect(key.fix).toMatch(/ANTHROPIC_API_KEY/);
    expect(docker.status).toBe("warn");
  });

  it("recognizes the mcpgen-prefixed key variable", async () => {
    const report = await runDoctor({
      nodeVersion: "v22.0.0",
      env: { MCPGEN_ANTHROPIC_API_KEY: "sk-ant-x" },
      dockerProbe: noDocker,
    });
    const key = report.checks.find((c) => c.id === "anthropic-key")!;
    expect(key.status).toBe("ok");
    expect(key.detail).toContain("MCPGEN_ANTHROPIC_API_KEY");
  });
});
