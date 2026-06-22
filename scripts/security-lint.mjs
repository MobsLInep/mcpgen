#!/usr/bin/env node
/**
 * mcpgen security lint.
 *
 * Runs the OWASP secure-MCP audit (packages/core/src/security/audit.ts) two ways:
 *
 *   1. Over a freshly *generated* MCP server — proves the generator upholds the
 *      checklist it documents in every SECURITY.md.
 *   2. Over *mcpgen's own* TypeScript source — proves the tool that preaches
 *      secure MCP practice also follows it (no secrets in logs, no eval/shell,
 *      no hardcoded credentials).
 *
 * Prints a human-readable checklist + any findings and exits non-zero if a
 * high-severity finding is present, so it can gate CI. Requires `@mcpgen/core`
 * to be built (`pnpm build`) — CI builds before linting.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

let core;
try {
  // Import the built library directly (the root has no @mcpgen/core dep to
  // resolve by name). Requires `pnpm build` first — CI builds before linting.
  core = await import(
    new URL("../packages/core/dist/index.js", import.meta.url).href
  );
} catch (error) {
  console.error(
    "security-lint: could not import @mcpgen/core — run `pnpm build` first.\n",
    error?.message ?? error,
  );
  process.exit(2);
}
const { auditFiles, auditGeneratedProject, openApiSource, generateProject } =
  core;

const C = {
  red: (s) => `[31m${s}[0m`,
  green: (s) => `[32m${s}[0m`,
  yellow: (s) => `[33m${s}[0m`,
  dim: (s) => `[2m${s}[0m`,
  bold: (s) => `[1m${s}[0m`,
};

/** Recursively collect files under `dir` matching `keep`, skipping `skipDir`. */
function walk(dir, keep, skipDir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (skipDir(name)) continue;
      out.push(...walk(full, keep, skipDir));
    } else if (keep(full)) {
      out.push(full);
    }
  }
  return out;
}

/** Build a path→contents map for mcpgen's own first-party source. */
function loadOwnSource() {
  const roots = [
    join(repoRoot, "packages", "core", "src"),
    join(repoRoot, "packages", "cli", "src"),
    join(repoRoot, "packages", "templates", "src"),
    join(repoRoot, "apps", "api", "src"),
    join(repoRoot, "apps", "web", "lib"),
    join(repoRoot, "apps", "web", "app"),
    join(repoRoot, "apps", "web", "components"),
  ];
  const skip = (name) =>
    name === "node_modules" ||
    name === "dist" ||
    name === ".next" ||
    name === ".turbo";
  const keep = (p) =>
    /\.(ts|tsx)$/.test(p) &&
    !/\.test\.tsx?$/.test(p) &&
    !/\.d\.ts$/.test(p) &&
    // The audit module is the signature database itself: its rule table holds
    // literal representations of dangerous patterns ("eval()", "shell: true").
    // A scanner can't meaningfully scan its own rule definitions.
    !/[/\\]security[/\\]audit\.ts$/.test(p);
  const files = {};
  for (const root of roots) {
    for (const file of walk(root, keep, skip)) {
      files[relative(repoRoot, file)] = readFileSync(file, "utf8");
    }
  }
  return files;
}

function printChecklist(title, audit) {
  console.log(C.bold(`\n${title}`));
  for (const item of audit.checklist) {
    const mark = item.passed ? C.green("PASS") : C.red("FAIL");
    const count = item.findings > 0 ? C.red(` (${item.findings})`) : "";
    console.log(`  ${mark} ${item.id}${count}  ${C.dim(item.description)}`);
  }
}

function printFindings(audit) {
  for (const f of audit.findings) {
    const sev =
      f.severity === "high"
        ? C.red("HIGH")
        : f.severity === "medium"
          ? C.yellow("MED ")
          : C.dim("LOW ");
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    console.log(`    ${sev} [${f.rule}] ${loc}\n         ${f.message}`);
  }
}

async function main() {
  console.log(C.bold("mcpgen security lint — OWASP secure-MCP checklist"));

  // 1. Generated output ------------------------------------------------------
  const specPath = join(
    repoRoot,
    "packages",
    "core",
    "test",
    "fixtures",
    "golden",
    "petstore.yaml",
  );
  const parsed = await openApiSource({ path: specPath }).parse();
  const project = await generateProject(parsed, {
    transport: "http",
    auth: "apikey",
  });
  const genAudit = auditGeneratedProject(project.files);
  printChecklist("Generated server (petstore, http + apikey)", genAudit);
  printFindings(genAudit);

  // 2. mcpgen's own source ---------------------------------------------------
  const ownFiles = loadOwnSource();
  const ownAudit = auditFiles(ownFiles, { mode: "source" });
  printChecklist(
    `mcpgen first-party source (${Object.keys(ownFiles).length} files)`,
    ownAudit,
  );
  printFindings(ownAudit);

  const highCount = [...genAudit.findings, ...ownAudit.findings].filter(
    (f) => f.severity === "high",
  ).length;

  console.log("");
  if (highCount > 0) {
    console.log(C.red(`✗ ${highCount} high-severity finding(s) — failing.`));
    process.exit(1);
  }
  console.log(C.green("✓ no high-severity findings."));
}

main().catch((error) => {
  console.error("security-lint failed:", error);
  process.exit(2);
});
