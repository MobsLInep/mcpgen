/**
 * @fileoverview Structured logging + opt-in, PII-free telemetry.
 *
 * mcpgen is a developer tool that handles people's API specs and credentials,
 * so observability is deliberately conservative:
 *
 *  - **Logging** is structured (one JSON object per line on stderr) and level
 *    filtered via `MCPGEN_LOG_LEVEL`. It defaults to `warn` so normal runs stay
 *    quiet, and it routes through an injectable sink so tests capture output
 *    instead of polluting the console.
 *  - **Telemetry** is *off by default* and only emits when `MCPGEN_TELEMETRY=1`.
 *    Events carry no PII: every property is run through {@link redactTelemetry},
 *    which keeps only numbers/booleans and a small allow-list of low-cardinality
 *    enum strings. Source content, file paths, titles, descriptions, URLs and
 *    credentials can never be attached to an event.
 *
 * Nothing here performs network I/O — telemetry is delivered to an injectable
 * sink (default: a structured `debug` log line), so wiring a real backend is a
 * deliberate, separate step.
 */

/** Log levels, most to least verbose. */
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

/** A structured log record. */
export interface LogRecord {
  readonly level: Exclude<LogLevel, "silent">;
  /** ISO timestamp. */
  readonly time: string;
  /** Logger name (subsystem). */
  readonly name: string;
  readonly msg: string;
  /** Structured fields (already free of secrets by construction at call sites). */
  readonly fields?: Record<string, unknown>;
}

/** Where structured records are written. */
export type LogSink = (record: LogRecord) => void;

/** The structured logger surface. */
export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /** Derive a child logger with an extended name. */
  child(suffix: string): Logger;
}

/** Resolve the active log level from the environment (default `warn`). */
export function resolveLogLevel(
  env: NodeJS.ProcessEnv = process.env,
): LogLevel {
  const raw = (env.MCPGEN_LOG_LEVEL ?? "").toLowerCase();
  return raw in LEVEL_RANK ? (raw as LogLevel) : "warn";
}

/** The default sink: one JSON object per line on stderr. */
export const stderrSink: LogSink = (record) => {
  console.error(JSON.stringify(record));
};

/** Options for {@link createLogger}. */
export interface LoggerOptions {
  /** Minimum level to emit (default: from `MCPGEN_LOG_LEVEL`, else `warn`). */
  readonly level?: LogLevel;
  /** Where records go (default: {@link stderrSink}). */
  readonly sink?: LogSink;
}

/**
 * Create a structured logger. Records below the active level are dropped before
 * the sink is called, so disabled levels cost nothing.
 */
export function createLogger(
  name: string,
  options: LoggerOptions = {},
): Logger {
  const level = options.level ?? resolveLogLevel();
  const sink = options.sink ?? stderrSink;
  const threshold = LEVEL_RANK[level];

  const emit = (
    recordLevel: Exclude<LogLevel, "silent">,
    msg: string,
    fields?: Record<string, unknown>,
  ): void => {
    if (LEVEL_RANK[recordLevel] < threshold) return;
    sink({
      level: recordLevel,
      time: new Date().toISOString(),
      name,
      msg,
      ...(fields && Object.keys(fields).length > 0 ? { fields } : {}),
    });
  };

  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (suffix) => createLogger(`${name}:${suffix}`, { level, sink }),
  };
}

// --- Telemetry (opt-in, PII-free) ------------------------------------------

/** Names of the events mcpgen may emit. Low-cardinality and stable. */
export type TelemetryEventName =
  | "generate.start"
  | "generate.complete"
  | "verify.complete"
  | "parse.complete";

/**
 * Property values telemetry is allowed to carry: numbers, booleans, and a small
 * set of low-cardinality enum strings (source kind, transport, auth mode,
 * outcome). Anything else is dropped by {@link redactTelemetry}.
 */
export type TelemetryValue = number | boolean | string;

/** Enum string values that are safe (no PII, low cardinality). */
const SAFE_ENUMS = new Set<string>([
  "openapi",
  "graphql",
  "repo",
  "stdio",
  "http",
  "apikey",
  "oauth",
  "none",
  "ok",
  "failed",
  "pass",
  "fail",
]);

/** A telemetry event after redaction. */
export interface TelemetryEvent {
  readonly name: TelemetryEventName;
  readonly time: string;
  readonly properties: Record<string, number | boolean | string>;
}

/** Where redacted telemetry events are delivered. */
export type TelemetrySink = (event: TelemetryEvent) => void;

/**
 * Strip a properties bag down to PII-free values: numbers and booleans are
 * always kept; strings are kept ONLY if they are a known safe enum value. This
 * is allow-list, not deny-list — an unanticipated string (a file path, a spec
 * title, an API key) is dropped rather than risk leaking it.
 */
export function redactTelemetry(
  properties: Record<string, unknown>,
): Record<string, number | boolean | string> {
  const out: Record<string, number | boolean | string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "string" && SAFE_ENUMS.has(value)) {
      out[key] = value;
    }
    // everything else (strings, objects, arrays) is intentionally dropped
  }
  return out;
}

/** Whether telemetry is enabled (opt-in via `MCPGEN_TELEMETRY=1`). */
export function telemetryEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const v = (env.MCPGEN_TELEMETRY ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

/** Options for {@link emitTelemetry}. */
export interface TelemetryOptions {
  /** Override the enabled check (mainly for tests). */
  readonly enabled?: boolean;
  /** Where the redacted event goes (default: a `debug` log line). */
  readonly sink?: TelemetrySink;
  readonly env?: NodeJS.ProcessEnv;
}

const telemetryLogger = createLogger("telemetry");

/**
 * Emit a telemetry event — a no-op unless telemetry is explicitly enabled. The
 * event's properties are always redacted to PII-free values first, so a buggy
 * call site can never leak a path/title/credential even if telemetry is on.
 * Returns the event that was emitted (or `undefined` when disabled), which makes
 * the redaction unit-testable.
 */
export function emitTelemetry(
  name: TelemetryEventName,
  properties: Record<string, unknown> = {},
  options: TelemetryOptions = {},
): TelemetryEvent | undefined {
  const enabled = options.enabled ?? telemetryEnabled(options.env);
  if (!enabled) return undefined;
  const event: TelemetryEvent = {
    name,
    time: new Date().toISOString(),
    properties: redactTelemetry(properties),
  };
  const sink =
    options.sink ??
    ((e: TelemetryEvent) => telemetryLogger.debug("telemetry", { event: e }));
  sink(event);
  return event;
}
