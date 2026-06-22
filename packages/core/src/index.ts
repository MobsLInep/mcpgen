import { templates, type TemplateDescriptor } from "@mcpgen/templates";

/** Version of the generation engine. */
export const CORE_VERSION = "0.0.0";

/**
 * Phase 1: the engine can ingest an OpenAPI spec, GraphQL schema, or code repo
 * and normalize it into the shared IR ({@link ToolCandidate}[] + metadata).
 * Rendering through {@link templates} lands in a later phase.
 */
export function describeEngine(): string {
  return `mcpgen core ${CORE_VERSION} (phase 1: input parsers, ${templates.length} templates registered)`;
}

// Intermediate representation + helpers.
export type {
  AuthRequirement,
  HttpMethod,
  InputKind,
  JsonSchema,
  JsonSchemaObject,
  OperationBinding,
  ParameterCandidate,
  ParameterLocation,
  ParseResult,
  Provenance,
  Source,
  SourceMetadata,
  ToolCandidate,
} from "./ir.js";
export {
  LOW_CONFIDENCE_THRESHOLD,
  isLowConfidence,
  sanitizeToolName,
  uniqueName,
} from "./ir.js";

// Parsers (factories returning a Source).
export { openApiSource, OpenApiValidationError } from "./parsers/openapi.js";
export type { OpenApiInput } from "./parsers/openapi.js";
export { graphqlSource } from "./parsers/graphql.js";
export type { GraphqlInput } from "./parsers/graphql.js";
export { codeSource } from "./parsers/code.js";
export type { CodeInput } from "./parsers/code.js";

// Source detection.
export { detectSource, UnknownSourceError } from "./detect.js";

export { templates };
export type { TemplateDescriptor };
