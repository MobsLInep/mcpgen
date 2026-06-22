/**
 * @fileoverview Environment diagnostics for `mcpgen doctor`.
 *
 * Pure-ish and reusable: the checks return a structured {@link DoctorReport}
 * that any front end (CLI, API) can render. The only I/O — probing whether
 * Docker is installed — sits behind an injectable {@link DockerProbe} (mirroring
 * how the toolchain and LLM are injectable), so tests run fully offline.
 */
import { execFile } from "node:child_process";

/** Severity of a single diagnostic. */
export type DoctorStatus = "ok" | "warn" | "fail";

/** One environment check and its outcome. */
export interface DoctorCheck {
  /** Short identifier, e.g. "node", "anthropic-key", "docker". */
  readonly id: string;
  /** Human-readable label. */
  readonly label: string;
  /** Pass / warn / fail. `warn` never blocks; `fail` does. */
  readonly status: DoctorStatus;
  /** What was found. */
  readonly detail: string;
  /** Suggested remediation, present when not `ok`. */
  readonly fix?: string;
}

/** The full diagnostic report. */
export interface DoctorReport {
  readonly checks: readonly DoctorCheck[];
  /** True when no check is a hard `fail`. */
  readonly ok: boolean;
}

/** Result of probing for Docker. */
export interface DockerStatus {
  readonly available: boolean;
  /** Version string when available, e.g. "Docker version 27.0.3". */
  readonly version?: string;
}

/** Injectable probe for Docker availability. */
export type DockerProbe = () => Promise<DockerStatus>;

/** Inputs for {@link runDoctor}; all optional and defaulted for production. */
export interface DoctorOptions {
  /** Node version string (default `process.version`, e.g. "v20.11.0"). */
  readonly nodeVersion?: string;
  /** Minimum supported Node major (default 20). */
  readonly minNodeMajor?: number;
  /** Environment to inspect (default `process.env`). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Docker probe (default shells out to `docker --version`). */
  readonly dockerProbe?: DockerProbe;
}

/** Environment variables that satisfy the Anthropic credential check. */
export const ANTHROPIC_KEY_VARS = [
  "MCPGEN_ANTHROPIC_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

/** Default Docker probe: shell out to `docker --version`. */
export const defaultDockerProbe: DockerProbe = () =>
  new Promise((resolvePromise) => {
    execFile("docker", ["--version"], { timeout: 5000 }, (error, stdout) => {
      if (error) {
        resolvePromise({ available: false });
        return;
      }
      resolvePromise({ available: true, version: stdout.trim() });
    });
  });

/** Parse the major version out of a `process.version`-style string. */
function nodeMajor(version: string): number | undefined {
  const match = /v?(\d+)\./.exec(version);
  return match ? Number.parseInt(match[1]!, 10) : undefined;
}

/** Check the Node.js runtime version. */
function checkNode(version: string, minMajor: number): DoctorCheck {
  const major = nodeMajor(version);
  if (major === undefined) {
    return {
      id: "node",
      label: "Node.js",
      status: "warn",
      detail: `could not parse version "${version}"`,
      fix: `install Node.js ${minMajor}+ from https://nodejs.org`,
    };
  }
  if (major < minMajor) {
    return {
      id: "node",
      label: "Node.js",
      status: "fail",
      detail: `${version} (need >= ${minMajor})`,
      fix: `upgrade to Node.js ${minMajor}+ (nvm install ${minMajor}); generated servers require it too`,
    };
  }
  return {
    id: "node",
    label: "Node.js",
    status: "ok",
    detail: `${version} (>= ${minMajor})`,
  };
}

/** Check that an Anthropic API key is present (warn-only — offline still works). */
function checkAnthropicKey(
  env: Readonly<Record<string, string | undefined>>,
): DoctorCheck {
  const found = ANTHROPIC_KEY_VARS.find((name) => {
    const value = env[name];
    return typeof value === "string" && value.length > 0;
  });
  if (found) {
    return {
      id: "anthropic-key",
      label: "Anthropic API key",
      status: "ok",
      detail: `found in $${found}`,
    };
  }
  return {
    id: "anthropic-key",
    label: "Anthropic API key",
    status: "warn",
    detail: "not set — generation falls back to deterministic (offline) mode",
    fix: `export ANTHROPIC_API_KEY=sk-ant-... for LLM-powered, higher-fidelity generation`,
  };
}

/** Check Docker availability (warn-only — only needed for container deploys). */
async function checkDocker(probe: DockerProbe): Promise<DoctorCheck> {
  const status = await probe();
  if (status.available) {
    return {
      id: "docker",
      label: "Docker",
      status: "ok",
      detail: status.version ?? "available",
    };
  }
  return {
    id: "docker",
    label: "Docker",
    status: "warn",
    detail: "not found — only required to build/deploy the generated container",
    fix: "install Docker Desktop or the engine from https://docs.docker.com/get-docker",
  };
}

/**
 * Run all environment diagnostics and return a structured report. Never throws;
 * a missing Docker binary or unparsable version surfaces as a check, not an
 * exception.
 */
export async function runDoctor(
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const nodeVersion = options.nodeVersion ?? process.version;
  const minNodeMajor = options.minNodeMajor ?? 20;
  const env = options.env ?? process.env;
  const dockerProbe = options.dockerProbe ?? defaultDockerProbe;

  const checks: DoctorCheck[] = [
    checkNode(nodeVersion, minNodeMajor),
    checkAnthropicKey(env),
    await checkDocker(dockerProbe),
  ];

  return { checks, ok: checks.every((c) => c.status !== "fail") };
}
