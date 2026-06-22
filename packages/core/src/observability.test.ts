/**
 * Tests for structured logging + opt-in telemetry. The privacy guarantees are
 * the point, so they get the most coverage: telemetry is off unless explicitly
 * enabled, and redaction drops anything that could be PII.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createLogger,
  emitTelemetry,
  redactTelemetry,
  resolveLogLevel,
  telemetryEnabled,
  type LogRecord,
  type TelemetryEvent,
} from "./observability.js";

describe("structured logger", () => {
  it("emits structured records to the sink at/above the level", () => {
    const records: LogRecord[] = [];
    const log = createLogger("test", {
      level: "info",
      sink: (r) => records.push(r),
    });
    log.debug("dropped"); // below threshold
    log.info("hello", { count: 3 });
    log.warn("careful");
    log.error("bad");

    expect(records.map((r) => r.level)).toEqual(["info", "warn", "error"]);
    const info = records[0]!;
    expect(info.name).toBe("test");
    expect(info.msg).toBe("hello");
    expect(info.fields).toEqual({ count: 3 });
    expect(typeof info.time).toBe("string");
  });

  it("silent level drops everything", () => {
    const records: LogRecord[] = [];
    const log = createLogger("q", {
      level: "silent",
      sink: (r) => records.push(r),
    });
    log.error("nope");
    expect(records).toEqual([]);
  });

  it("child loggers extend the name and inherit level + sink", () => {
    const records: LogRecord[] = [];
    const log = createLogger("parent", {
      level: "debug",
      sink: (r) => records.push(r),
    });
    log.child("child").info("hi");
    expect(records[0]!.name).toBe("parent:child");
  });

  it("resolveLogLevel reads MCPGEN_LOG_LEVEL and defaults to warn", () => {
    expect(resolveLogLevel({ MCPGEN_LOG_LEVEL: "debug" })).toBe("debug");
    expect(resolveLogLevel({ MCPGEN_LOG_LEVEL: "BOGUS" })).toBe("warn");
    expect(resolveLogLevel({})).toBe("warn");
  });
});

describe("telemetry is opt-in", () => {
  it("is disabled by default (no env)", () => {
    expect(telemetryEnabled({})).toBe(false);
    const sink = vi.fn();
    const event = emitTelemetry(
      "generate.start",
      { toolCount: 5 },
      { env: {}, sink },
    );
    expect(event).toBeUndefined();
    expect(sink).not.toHaveBeenCalled();
  });

  it("emits only when explicitly enabled", () => {
    expect(telemetryEnabled({ MCPGEN_TELEMETRY: "1" })).toBe(true);
    expect(telemetryEnabled({ MCPGEN_TELEMETRY: "true" })).toBe(true);
    expect(telemetryEnabled({ MCPGEN_TELEMETRY: "0" })).toBe(false);

    const events: TelemetryEvent[] = [];
    const event = emitTelemetry(
      "generate.complete",
      { toolCount: 3, transport: "http", ok: true },
      { enabled: true, sink: (e) => events.push(e) },
    );
    expect(event).toBeDefined();
    expect(events).toHaveLength(1);
    expect(events[0]!.name).toBe("generate.complete");
    expect(events[0]!.properties).toEqual({
      toolCount: 3,
      transport: "http",
      ok: true,
    });
  });
});

describe("telemetry redaction (no PII)", () => {
  it("keeps numbers, booleans, and safe enums only", () => {
    const out = redactTelemetry({
      toolCount: 7,
      durationMs: 1234,
      ok: false,
      transport: "stdio",
      sourceKind: "openapi",
      auth: "apikey",
    });
    expect(out).toEqual({
      toolCount: 7,
      durationMs: 1234,
      ok: false,
      transport: "stdio",
      sourceKind: "openapi",
      auth: "apikey",
    });
  });

  it("drops free-form strings that could be PII", () => {
    const out = redactTelemetry({
      // these must never survive
      sourcePath: "/home/alice/secret-api/openapi.yaml",
      title: "Alice's Internal Billing API",
      apiKey: "sk-live-abcdef123456",
      baseUrl: "https://internal.acme.corp/api",
      description: "lots of detail about a private system",
      // these survive
      toolCount: 2,
    });
    expect(out).toEqual({ toolCount: 2 });
    expect(Object.values(out)).not.toContain(
      "/home/alice/secret-api/openapi.yaml",
    );
  });

  it("drops nested objects/arrays entirely", () => {
    const out = redactTelemetry({
      nested: { a: 1 },
      list: [1, 2, 3],
      keep: 5,
    });
    expect(out).toEqual({ keep: 5 });
  });

  it("redaction is applied even with a custom sink", () => {
    const events: TelemetryEvent[] = [];
    emitTelemetry(
      "parse.complete",
      { secretPath: "/etc/passwd", toolCount: 1 },
      { enabled: true, sink: (e) => events.push(e) },
    );
    expect(events[0]!.properties).toEqual({ toolCount: 1 });
  });
});
