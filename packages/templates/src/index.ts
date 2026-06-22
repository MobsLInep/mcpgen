/** Describes a single MCP server code template. */
export interface TemplateDescriptor {
  /** Stable identifier, e.g. "typescript-stdio". */
  id: string;
  /** Human-readable summary of what the template produces. */
  description: string;
}

/**
 * Registered templates. Empty in Phase 0 — real MCP server templates land in
 * Phase 1 alongside the generation engine.
 */
export const templates: TemplateDescriptor[] = [];
