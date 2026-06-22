import { templates, type TemplateDescriptor } from "@mcpgen/templates";

/** Version of the generation engine. */
export const CORE_VERSION = "0.1.0";

/**
 * Phase 2: the engine ingests an OpenAPI spec, GraphQL schema, or code repo,
 * normalizes it into the shared IR ({@link ToolCandidate}[] + metadata), and
 * renders that IR into a complete MCP server project via {@link generateProject}
 * and the {@link templates}.
 */
export function describeEngine(): string {
  return `mcpgen core ${CORE_VERSION} (phase 2: parsers + generation engine, ${templates.length} templates registered)`;
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

// Environment diagnostics (Phase 4 — `mcpgen doctor`).
export {
  runDoctor,
  defaultDockerProbe,
  ANTHROPIC_KEY_VARS,
} from "./doctor.js";
export type {
  DoctorReport,
  DoctorCheck,
  DoctorStatus,
  DoctorOptions,
  DockerProbe,
  DockerStatus,
} from "./doctor.js";

// Generation engine (Phase 2).
export {
  generateProject,
  writeProject,
  fallbackPlan,
} from "./generate/engine.js";
export type { GenerateOptions, GeneratedProject, AuthMode } from "./generate/engine.js";
export {
  DEFAULT_MODEL,
  MockLlmClient,
  MissingApiKeyError,
  createAnthropicClient,
  resolveApiKey,
  resolveModel,
} from "./generate/llm.js";
export type { LlmClient, LlmRequest, LlmResponse, LlmMessage } from "./generate/llm.js";
export {
  MemoryResponseStore,
  FileResponseStore,
  ScriptedLlmClient,
  cachingClient,
  hashRequest,
} from "./generate/cache.js";
export type { ResponseStore } from "./generate/cache.js";
export { runPlan, PlanValidationError } from "./generate/plan.js";
export type { Plan, PlannedTool } from "./generate/plan.js";
export {
  synthesizeTool,
  fallbackSynthesize,
  buildInputShape,
  buildHandlerBody,
} from "./generate/synthesize.js";
export type { ToolCode } from "./generate/synthesize.js";
export { assembleProject } from "./generate/assemble.js";
export type { AssembleOptions } from "./generate/assemble.js";

// Verification & self-repair loop (Phase 3).
export { verifyProject } from "./verify/verify.js";
export type {
  VerifyOptions,
  VerifyResult,
  VerifyEvent,
} from "./verify/verify.js";
export { NodeToolchain, DRIVER_SOURCE } from "./verify/toolchain.js";
export type {
  Toolchain,
  NodeToolchainOptions,
  InstallOutcome,
  BuildOutcome,
  DriverSpec,
  DriverCall,
  DriverOutcome,
  ToolCallResult,
} from "./verify/toolchain.js";
export { openApiExampleMock } from "./verify/mock.js";
export type {
  MockUpstream,
  MockUpstreamFactory,
  UpstreamMock,
} from "./verify/mock.js";
export { sampleFromSchema, sampleToolInput } from "./verify/sample.js";
export type { SampleOptions } from "./verify/sample.js";
export { repairFile } from "./verify/repair.js";
export type {
  RepairRequest,
  RepairPatch,
  StageName,
} from "./verify/repair.js";
export { renderReport } from "./verify/report.js";
export type {
  ReportInput,
  StageOutcome,
  RepairRecord,
} from "./verify/report.js";

export { templates };
export type { TemplateDescriptor };
