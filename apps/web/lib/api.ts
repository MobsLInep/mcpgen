/**
 * @fileoverview Thin client for the mcpgen API. Everything the browser does goes
 * through here so the base URL and error handling live in one place.
 */
import type {
  CreateJobRequest,
  JobEvent,
  ParseResponse,
  SourceKind,
} from "./protocol";

/** API base URL; overridable for deploys via `NEXT_PUBLIC_API_URL`. */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "http://localhost:3001";

async function asError(res: Response): Promise<never> {
  let message = `Request failed (${res.status}).`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // non-JSON error body
  }
  throw new Error(message);
}

/** Parse a pasted spec / URL into a tool list. */
export async function parseSource(input: {
  source: string;
  kind?: SourceKind;
}): Promise<ParseResponse> {
  const res = await fetch(`${API_BASE}/api/parse`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) return asError(res);
  return (await res.json()) as ParseResponse;
}

/** Create a generation job; returns its id. */
export async function createJob(req: CreateJobRequest): Promise<string> {
  const res = await fetch(`${API_BASE}/api/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) return asError(res);
  const body = (await res.json()) as { id: string };
  return body.id;
}

/**
 * Subscribe to a job's progress over SSE. Returns a disposer. `onEvent` fires
 * for every event; the stream closes itself when the job ends.
 */
export function streamJob(
  id: string,
  onEvent: (event: JobEvent) => void,
  onError?: (err: Error) => void,
): () => void {
  const es = new EventSource(`${API_BASE}/api/jobs/${id}/events`);
  let closed = false;
  es.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data) as JobEvent;
      onEvent(event);
      if (
        event.type === "phase" &&
        (event.phase === "done" || event.phase === "error")
      ) {
        closed = true;
        es.close();
      }
    } catch {
      // ignore malformed frame
    }
  };
  es.onerror = () => {
    // EventSource fires onerror on normal close too; only surface real failures.
    if (!closed && es.readyState === EventSource.CLOSED) {
      onError?.(new Error("Connection to the generation stream was lost."));
    }
  };
  return () => {
    closed = true;
    es.close();
  };
}

/** Fetch the generated file map for a finished job. */
export async function fetchFiles(id: string): Promise<Record<string, string>> {
  const res = await fetch(`${API_BASE}/api/jobs/${id}/files`);
  if (!res.ok) return asError(res);
  return (await res.json()) as Record<string, string>;
}

/** Fetch the Claude Desktop / Cursor config object for a finished job. */
export async function fetchConfig(id: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}/api/jobs/${id}/config`);
  if (!res.ok) return asError(res);
  return res.json();
}

/** URL for the result zip download. */
export function downloadUrl(id: string): string {
  return `${API_BASE}/api/jobs/${id}/download`;
}
