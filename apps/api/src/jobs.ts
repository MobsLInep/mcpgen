/**
 * @fileoverview In-memory job store + a tiny concurrency-limited queue.
 *
 * A generation job is long-running (parse → generate → optionally verify), so
 * the HTTP layer creates a job and returns immediately; the browser then streams
 * progress over SSE (`GET /api/jobs/:id/events`) or polls `GET /api/jobs/:id`.
 *
 * Events are buffered on the job so a client that connects late (or reconnects)
 * still receives the full history before live updates. Finished jobs and their
 * generated files are evicted after a TTL to bound memory.
 */
import { randomUUID } from "node:crypto";
import type {
  CreateJobRequest,
  JobEvent,
  JobPhase,
  JobSummary,
} from "./protocol.js";

export interface Job {
  readonly id: string;
  readonly request: CreateJobRequest;
  phase: JobPhase;
  readonly events: JobEvent[];
  summary?: JobSummary;
  error?: string;
  /** Generated files, kept for download once the job succeeds. */
  files?: ReadonlyMap<string, string>;
  /** Server name, used to name the downloaded zip. */
  serverName?: string;
  readonly createdAt: number;
  finishedAt?: number;
  /** Live SSE subscribers. */
  readonly listeners: Set<(event: JobEvent) => void>;
}

/** Signature a runner implements; `emit` streams progress as it works. */
export type JobRunner = (
  job: Job,
  emit: (event: JobEvent) => void,
) => Promise<{
  summary: JobSummary;
  files: ReadonlyMap<string, string>;
  serverName: string;
}>;

export interface JobStoreOptions {
  /** Max jobs running at once (default 2). */
  readonly concurrency?: number;
  /** Milliseconds a finished job is retained for download/replay (default 10m). */
  readonly ttlMs?: number;
}

export class JobStore {
  private readonly jobs = new Map<string, Job>();
  private readonly waiting: Job[] = [];
  private active = 0;
  private readonly concurrency: number;
  private readonly ttlMs: number;

  constructor(
    private readonly runner: JobRunner,
    options: JobStoreOptions = {},
  ) {
    this.concurrency = options.concurrency ?? 2;
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  }

  /** Enqueue a new job and kick the queue. Returns the job id. */
  create(request: CreateJobRequest): string {
    this.evictExpired();
    const job: Job = {
      id: randomUUID(),
      request,
      phase: "queued",
      events: [{ type: "phase", phase: "queued" }],
      createdAt: Date.now(),
      listeners: new Set(),
    };
    this.jobs.set(job.id, job);
    this.waiting.push(job);
    this.pump();
    return job.id;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /** Subscribe to live events for a job; returns an unsubscribe function. */
  subscribe(id: string, listener: (event: JobEvent) => void): () => void {
    const job = this.jobs.get(id);
    if (!job) return () => {};
    job.listeners.add(listener);
    return () => job.listeners.delete(listener);
  }

  private emit(job: Job, event: JobEvent): void {
    job.events.push(event);
    if (event.type === "phase") job.phase = event.phase;
    for (const listener of job.listeners) {
      try {
        listener(event);
      } catch {
        // a broken listener must not break the job
      }
    }
  }

  private pump(): void {
    while (this.active < this.concurrency && this.waiting.length > 0) {
      const job = this.waiting.shift()!;
      this.active += 1;
      void this.run(job);
    }
  }

  private async run(job: Job): Promise<void> {
    const emit = (event: JobEvent): void => this.emit(job, event);
    try {
      const { summary, files, serverName } = await this.runner(job, emit);
      job.summary = summary;
      job.files = files;
      job.serverName = serverName;
      emit({ type: "done", summary });
      emit({ type: "phase", phase: "done" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      job.error = message;
      emit({ type: "error", message });
      emit({ type: "phase", phase: "error" });
    } finally {
      job.finishedAt = Date.now();
      this.active -= 1;
      this.pump();
    }
  }

  private evictExpired(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, job] of this.jobs) {
      if (job.finishedAt && job.finishedAt < cutoff) this.jobs.delete(id);
    }
  }
}
