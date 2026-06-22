/**
 * @fileoverview The mcpgen API server: parse, generate-as-a-job, stream progress
 * over SSE, and download the result. Built on raw `node:http` with a tiny manual
 * router — no web framework, matching the rest of the monorepo.
 *
 * Endpoints (all under `/api`):
 *   GET  /api/health                 — liveness + which runner is active
 *   POST /api/parse                  — { source, kind? } → detected tools
 *   POST /api/jobs                   — create a generation job → { id }
 *   GET  /api/jobs/:id               — status snapshot (+ buffered events)
 *   GET  /api/jobs/:id/events        — SSE stream of progress events
 *   GET  /api/jobs/:id/files         — { path: contents } of the result
 *   GET  /api/jobs/:id/download      — the generated server as a .zip
 *   GET  /api/jobs/:id/config        — Claude Desktop / Cursor config JSON
 */
import { createServer, type Server } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { claudeConfig } from "./config.js";
import { HttpError, clientIp, readJson, sendJson, setCors } from "./http.js";
import { JobStore } from "./jobs.js";
import { ParseInputError, resolveSource, toParseResponse } from "./parse.js";
import type { CreateJobRequest, JobEvent } from "./protocol.js";
import { createRateLimiter } from "./ratelimit.js";
import { fakeRunner } from "./fake-runner.js";
import { realRunner } from "./runner.js";
import { zipProject } from "./zip.js";

const kindSchema = z.enum(["openapi", "graphql", "repo"]);

const parseSchema = z.object({
  source: z.string().min(1, "source is required"),
  kind: kindSchema.optional(),
});

const createJobSchema = z.object({
  source: z.string().min(1, "source is required"),
  kind: kindSchema.optional(),
  transport: z.enum(["stdio", "http"]),
  auth: z.enum(["apikey", "oauth", "none"]),
  useAi: z.boolean().optional(),
  verify: z.boolean().optional(),
  tools: z
    .array(
      z.object({
        name: z.string(),
        enabled: z.boolean(),
        newName: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
});

export interface ApiServerOptions {
  /** Force the deterministic runner (also enabled by `MCPGEN_FAKE`). */
  readonly fake?: boolean;
  /** Job concurrency (default 2). */
  readonly concurrency?: number;
}

/** Whether the deterministic fake runner should be used. */
function useFake(options: ApiServerOptions): boolean {
  return options.fake === true || process.env.MCPGEN_FAKE === "1";
}

export function createApiServer(options: ApiServerOptions = {}): Server {
  const fake = useFake(options);
  const store = new JobStore(fake ? fakeRunner : realRunner, {
    concurrency: options.concurrency,
  });

  // Heavier mutations (parse/create) get a stricter budget than reads.
  const writeLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    setCors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";

    // --- health ----------------------------------------------------------
    if (path === "/api/health" && method === "GET") {
      sendJson(res, 200, {
        service: "mcpgen-api",
        status: "ok",
        runner: fake ? "fake" : "real",
      });
      return;
    }

    // --- parse -----------------------------------------------------------
    if (path === "/api/parse" && method === "POST") {
      rateLimit(req, writeLimiter);
      const body = parseSchema.parse(await readJson(req));
      const { source, kind } = await resolveSource(body);
      const result = await source.parse();
      sendJson(res, 200, toParseResponse(result, kind));
      return;
    }

    // --- create job ------------------------------------------------------
    if (path === "/api/jobs" && method === "POST") {
      rateLimit(req, writeLimiter);
      const body = createJobSchema.parse(
        await readJson(req),
      ) as CreateJobRequest;
      const id = store.create(body);
      sendJson(res, 202, { id });
      return;
    }

    // --- per-job routes --------------------------------------------------
    const jobMatch =
      /^\/api\/jobs\/([^/]+)(\/(events|files|download|config))?$/.exec(path);
    if (jobMatch && method === "GET") {
      const id = jobMatch[1]!;
      const sub = jobMatch[3];
      const job = store.get(id);
      if (!job) throw new HttpError(404, "Job not found.");

      if (!sub) {
        sendJson(res, 200, {
          id: job.id,
          phase: job.phase,
          events: job.events,
          summary: job.summary,
          error: job.error,
        });
        return;
      }

      if (sub === "events") {
        streamEvents(req, res, store, id);
        return;
      }

      if (sub === "files") {
        if (!job.files)
          throw new HttpError(409, "Job has not produced files yet.");
        sendJson(res, 200, Object.fromEntries(job.files));
        return;
      }

      if (sub === "download") {
        if (!job.files)
          throw new HttpError(409, "Job has not produced files yet.");
        const name = job.serverName ?? "mcp-server";
        const buf = await zipProject(name, job.files);
        res.writeHead(200, {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${name}.zip"`,
          "content-length": String(buf.length),
        });
        res.end(buf);
        return;
      }

      if (sub === "config") {
        if (!job.summary) throw new HttpError(409, "Job is not finished yet.");
        sendJson(
          res,
          200,
          claudeConfig(
            job.summary.serverName,
            job.request.transport,
            job.request.auth,
          ),
        );
        return;
      }
    }

    throw new HttpError(404, "Not found.");
  }

  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message });
        return;
      }
      if (err instanceof ParseInputError) {
        sendJson(res, 400, { error: err.message });
        return;
      }
      if (err instanceof z.ZodError) {
        sendJson(res, 400, { error: "Invalid request.", issues: err.issues });
        return;
      }
      const message = err instanceof Error ? err.message : "Internal error.";
      sendJson(res, 500, { error: message });
    });
  });
}

/** Apply a rate limiter, throwing a 429 with a Retry-After hint when exceeded. */
function rateLimit(
  req: IncomingMessage,
  limiter: ReturnType<typeof createRateLimiter>,
): void {
  const { allowed, resetAt } = limiter.check(clientIp(req));
  if (!allowed) {
    const retry = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    throw new HttpError(429, `Rate limit exceeded. Try again in ${retry}s.`);
  }
}

/** Open an SSE stream that replays buffered events, then streams live ones. */
function streamEvents(
  req: IncomingMessage,
  res: ServerResponse,
  store: JobStore,
  id: string,
): void {
  const job = store.get(id)!;
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  const write = (event: JobEvent): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Replay history so late/reconnecting clients catch up.
  for (const event of job.events) write(event);

  // If the job already finished, close after replaying.
  if (job.phase === "done" || job.phase === "error") {
    res.end();
    return;
  }

  const unsubscribe = store.subscribe(id, (event) => {
    write(event);
    if (
      event.type === "phase" &&
      (event.phase === "done" || event.phase === "error")
    ) {
      unsubscribe();
      res.end();
    }
  });

  // Heartbeat keeps proxies from closing an idle connection.
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
  res.on("close", () => clearInterval(heartbeat));
}
