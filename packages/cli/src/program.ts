import { Command } from "commander";
import { CORE_VERSION, describeEngine } from "@mcpgen/core";

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

  return program;
}
