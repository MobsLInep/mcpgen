/**
 * @fileoverview Public surface of the verification & self-repair loop.
 */
export { verifyProject } from "./verify.js";
export type { VerifyOptions, VerifyResult, VerifyEvent } from "./verify.js";
export {
  NodeToolchain,
  DRIVER_SOURCE,
} from "./toolchain.js";
export type {
  Toolchain,
  NodeToolchainOptions,
  InstallOutcome,
  BuildOutcome,
  DriverSpec,
  DriverCall,
  DriverOutcome,
  ToolCallResult,
} from "./toolchain.js";
export { openApiExampleMock } from "./mock.js";
export type { MockUpstream, MockUpstreamFactory, UpstreamMock } from "./mock.js";
export { sampleFromSchema, sampleToolInput } from "./sample.js";
export type { SampleOptions } from "./sample.js";
export { repairFile } from "./repair.js";
export type { RepairRequest, RepairPatch, StageName } from "./repair.js";
export { renderReport } from "./report.js";
export type { ReportInput, StageOutcome, RepairRecord } from "./report.js";
