/**
 * @fileoverview Minimal HTTP plumbing shared by the route handlers: CORS,
 * JSON body reading with a size cap, and typed JSON responses. Kept dependency-
 * free (raw `node:http`) to match the rest of the service.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY_BYTES = 6_000_000; // a touch above the 5 MB remote-spec ceiling

/** Allowed CORS origins (comma-separated env, or `*`). */
function allowedOrigin(req: IncomingMessage): string {
  const configured = process.env.MCPGEN_CORS_ORIGIN;
  if (!configured || configured === "*") return "*";
  const origins = configured.split(",").map((s) => s.trim());
  const origin = req.headers.origin;
  return origin && origins.includes(origin) ? origin : origins[0]!;
}

export function setCors(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", allowedOrigin(req));
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("vary", "origin");
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

/** The client's IP, honoring a single proxy hop via `x-forwarded-for`. */
export function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0]!.trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** Read and JSON-parse the request body, enforcing a size cap. */
export async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new HttpError(413, "Request body too large.");
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
}

/** Error carrying an HTTP status, mapped to a JSON error response by the server. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
