import { Command } from "commander";
import { CORE_VERSION, describeEngine } from "@mcpgen/core";
import { runInspect } from "./inspect.js";
import { type AuthMode, runGenerate } from "./generate.js";

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
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`mcpgen inspect: ${message}\n`);
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
          const out = await runGenerate(source, {
            out: options.out,
            transport: options.transport as "http" | "stdio",
            auth: options.auth as AuthMode | undefined,
            model: options.model,
            offline: options.offline,
          });
          process.stdout.write(`${out}\n`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(`mcpgen generate: ${message}\n`);
          process.exitCode = 1;
        }
      },
    );

  return program;
}
