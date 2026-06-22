import { templates, type TemplateDescriptor } from "@mcpgen/templates";

/** Version of the generation engine. */
export const CORE_VERSION = "0.0.0";

/** The kinds of input mcpgen can generate an MCP server from. */
export type InputKind = "openapi" | "graphql" | "repo";

/**
 * Phase 0 placeholder. The real engine will parse an input into an intermediate
 * representation and render it through {@link templates}. Not implemented yet.
 */
export function describeEngine(): string {
  return `mcpgen core ${CORE_VERSION} (phase 0 scaffold, ${templates.length} templates registered)`;
}

export { templates };
export type { TemplateDescriptor };
