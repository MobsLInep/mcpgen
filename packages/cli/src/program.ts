import { Command } from "commander";
import { CORE_VERSION, describeEngine } from "@mcpgen/core";
import { runInspect } from "./inspect.js";
import { type AuthMode, runGenerate } from "./generate.js";
import { runInit } from "./init.js";
import { runDoctorCommand } from "./doctor.js";
import { COMPLETION_SHELLS, completionScript } from "./completion.js";
import { nextSteps, printError, summaryPanel } from "./ui.js";

const TRANSPORTS = new Set(["http", "stdio"]);
const AUTH_MODES = new Set(["apikey", "oauth", "none"]);

/** Build the `mcpgen` command tree. Kept separate from the bin entry so it can
 * be unit-tested without parsing `process.argv`. */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("mcpgen")
    .description(
      "Generate a typed, deployable MCP server from an OpenAPI spec, GraphQL schema, or repo",
    )
    .version(CORE_VERSION);

  program
    .command("info")
    .description("Print information about the generation engine")
    .action(() => {
      process.stdout.write(`${describeEngine()}\n`);
    });

  program
    .command("init")
    .description("Guided wizard: pick a source, transport, auth, and output dir")
    .action(async () => {
      try {
        const code = await runInit();
        if (code !== 0) process.exitCode = code;
      } catch (error) {
        printError("init", error);
        process.exitCode = 1;
      }
    });

  program
    .command("doctor")
    .description("Check the local environment (Node, API key, Docker)")
    .option("--json", "Print the report as JSON")
    .action(async (options: { json?: boolean }) => {
      try {
        const { output, ok } = await runDoctorCommand(options);
        process.stdout.write(`${output}\n`);
        if (!ok) process.exitCode = 1;
      } catch (error) {
        printError("doctor", error);
        process.exitCode = 1;
      }
    });

  program
    .command("completion")
    .argument(
      "[shell]",
      `Shell to emit completion for (${COMPLETION_SHELLS.join(", ")})`,
    )
    .description("Print a shell completion script")
    .action((shell?: string) => {
      try {
        if (!shell) {
          throw new Error(
            `specify a shell: ${COMPLETION_SHELLS.join(", ")} (e.g. \`mcpgen completion bash\`)`,
          );
        }
        process.stdout.write(completionScript(shell));
      } catch (error) {
        printError("completion", error);
        process.exitCode = 1;
      }
    });

  program
    .command("inspect")
    .argument(
      "<source>",
      "Path to an OpenAPI spec, GraphQL schema, or code directory",
    )
    .option("--json", "Print the parsed IR as JSON instead of a table")
    .description("Parse a source and print a summary of its tool candidates")
    .action(async (source: string, options: { json?: boolean }) => {
      try {
        const out = await runInspect(source, options);
        process.stdout.write(`${out}\n`);
      } catch (error) {
        printError("inspect", error);
        process.exitCode = 1;
      }
    });

  program
    .command("generate")
    .argument(
      "<source>",
      "Path to an OpenAPI spec, GraphQL schema, or code directory",
    )
    .requiredOption("-o, --out <dir>", "Directory to write the generated server")
    .option("--transport <kind>", "Transport: http or stdio", "stdio")
    .option("--auth <mode>", "Auth handling: apikey, oauth, or none")
    .option("--model <id>", "Claude model id (overrides MCPGEN_MODEL)")
    .option("--offline", "Skip the LLM; deterministic generation only")
    .option("--json", "Print a machine-readable summary instead of the panel")
    .option(
      "--no-verify",
      "Skip the post-generation verification & self-repair loop",
    )
    .option(
      "--max-repairs <n>",
      "Max self-repair iterations during verification",
      "3",
    )
    .description("Generate a typed, deployable MCP server from a source")
    .action(
      async (
        source: string,
        options: {
          out: string;
          transport: string;
          auth?: string;
          model?: string;
          offline?: boolean;
          json?: boolean;
          verify: boolean;
          maxRepairs: string;
        },
      ) => {
        try {
          if (!TRANSPORTS.has(options.transport)) {
            throw new Error(
              `invalid --transport "${options.transport}" (expected http or stdio)`,
            );
          }
          if (options.auth && !AUTH_MODES.has(options.auth)) {
            throw new Error(
              `invalid --auth "${options.auth}" (expected apikey, oauth, or none)`,
            );
          }
          const maxRepairs = Number.parseInt(options.maxRepairs, 10);
          if (!Number.isInteger(maxRepairs) || maxRepairs < 0) {
            throw new Error(
              `invalid --max-repairs "${options.maxRepairs}" (expected a non-negative integer)`,
            );
          }
          const { ok, summary } = await runGenerate(source, {
            out: options.out,
            transport: options.transport as "http" | "stdio",
            auth: options.auth as AuthMode | undefined,
            model: options.model,
            offline: options.offline,
            verify: options.verify,
            maxRepairs,
            // In --json mode keep stdout clean; progress still goes to stderr.
            log: options.json ? () => {} : undefined,
          });

          if (options.json) {
            process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
          } else {
            process.stdout.write(`${summaryPanel(summary)}\n\n`);
            process.stdout.write("Next steps:\n");
            process.stdout.write(
              `${nextSteps(summary.outDir, summary.transport)
                .split("\n")
                .map((l) => (l ? `  ${l}` : l))
                .join("\n")}\n`,
            );
          }
          if (!ok) process.exitCode = 1;
        } catch (error) {
          printError("generate", error);
          process.exitCode = 1;
        }
      },
    );

  return program;
}
