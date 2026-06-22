/**
 * `mcpgen doctor` — check the local environment (Node version, Anthropic API
 * key, Docker) and print a readable report. The checks themselves live in
 * `@mcpgen/core` (`runDoctor`); this module only renders them.
 */
import { type DoctorReport, runDoctor } from "@mcpgen/core";
import { pc, statusIcon } from "./ui.js";

export interface DoctorCliOptions {
  /** Emit the raw report as JSON instead of a rendered table. */
  json?: boolean;
}

/** Render a {@link DoctorReport} as human-readable text. */
export function formatDoctor(report: DoctorReport): string {
  const lines = [pc.bold("mcpgen doctor — environment check"), ""];
  for (const check of report.checks) {
    lines.push(
      `${statusIcon(check.status)} ${pc.bold(check.label)}: ${check.detail}`,
    );
    if (check.fix) lines.push(`  ${pc.dim("→")} ${check.fix}`);
  }
  lines.push("");
  lines.push(
    report.ok
      ? pc.green("All required checks passed.")
      : pc.red("Some required checks failed — see the fixes above."),
  );
  return lines.join("\n");
}

/** Run the doctor command. Returns `{ output, ok }` for the caller to print. */
export async function runDoctorCommand(
  options: DoctorCliOptions = {},
): Promise<{ output: string; ok: boolean }> {
  const report = await runDoctor();
  if (options.json) {
    return { output: JSON.stringify(report, null, 2), ok: report.ok };
  }
  return { output: formatDoctor(report), ok: report.ok };
}
