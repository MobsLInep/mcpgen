import { Command } from "commander";
import { CORE_VERSION, describeEngine } from "@mcpgen/core";
import { runInspect } from "./inspect.js";

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

  return program;
}
