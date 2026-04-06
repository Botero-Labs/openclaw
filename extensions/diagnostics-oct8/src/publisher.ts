import type { AgentEventPayload, DiagnosticEventPayload } from "../api.js";

export const OCT8_MAX_BATCH_SIZE = 500;
const SHUTDOWN_FLUSH_TIMEOUT_MS = 2_000;

export type Oct8PublisherLogger = {
  debug?: (message: string) => void;
  info?: (message: string) => void;
  warn: (message: string) => void;
  error?: (message: string) => void;
};

export type Oct8PublisherFetch = typeof fetch;

export type Oct8PublisherTimers = {
  now: () => number;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

export type Oct8IngestAgentEvent = {
  runId: string;
  seq: number;
  stream: string;
  ts: number;
  sessionKey?: string;
  data: Record<string, unknown>;
};

export type Oct8IngestDiagnostic = {
  type: "model.usage";
  seq: number;
  ts: number;
  runId?: string;
  sessionKey?: string;
  sessionId?: string;
  channel?: string;
  provider?: string;
  model?: string;
  usage?: Record<string, unknown>;
  lastCallUsage?: Record<string, unknown>;
  context?: Record<string, unknown>;
  costUsd?: number;
  durationMs?: number;
};

type Oct8QueueItem =
  | { kind: "event"; value: Oct8IngestAgentEvent }
  | { kind: "diagnostic"; value: Oct8IngestDiagnostic };

export type Oct8PublisherConfig = {
  baseUrl: string;
  orgId: string;
  coworkerId: string;
  gatewayId: string;
  deploymentTargetId: string;
  gatewayToken: string;
  flushIntervalMs: number;
  maxBatchSize: number;
  maxQueueSize: number;
  requestTimeoutMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
};

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function truncateForLog(value: string | undefined, max = 240): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function calculateRetryDelayMs(attempt: number, retryBaseMs: number, retryMaxMs: number): number {
  const exponent = Math.max(0, attempt);
  const delay = retryBaseMs * 2 ** exponent;
  return Math.min(retryMaxMs, delay);
}

function sleep(timers: Oct8PublisherTimers, durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = timers.setTimeout(() => {
      timers.clearTimeout(timer);
      resolve();
    }, durationMs);
  });
}

async function readResponseTextSafe(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}

function cleanOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function cleanOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function mapAgentEventForOct8(event: AgentEventPayload): Oct8IngestAgentEvent | null {
  if (event.stream !== "lifecycle" && event.stream !== "tool" && event.stream !== "compaction") {
    return null;
  }

  return {
    runId: event.runId,
    seq: event.seq,
    stream: event.stream,
    ts: event.ts,
    ...(cleanOptionalString(event.sessionKey) ? { sessionKey: event.sessionKey } : {}),
    data: event.data,
  };
}

export function mapDiagnosticEventForOct8(
  event: DiagnosticEventPayload,
): Oct8IngestDiagnostic | null {
  if (event.type !== "model.usage") {
    return null;
  }

  return {
    type: "model.usage",
    seq: event.seq,
    ts: event.ts,
    ...(cleanOptionalString(event.runId) ? { runId: event.runId } : {}),
    ...(cleanOptionalString(event.sessionKey) ? { sessionKey: event.sessionKey } : {}),
    ...(cleanOptionalString(event.sessionId) ? { sessionId: event.sessionId } : {}),
    ...(cleanOptionalString(event.channel) ? { channel: event.channel } : {}),
    ...(cleanOptionalString(event.provider) ? { provider: event.provider } : {}),
    ...(cleanOptionalString(event.model) ? { model: event.model } : {}),
    ...(cleanOptionalRecord(event.usage) ? { usage: event.usage } : {}),
    ...(cleanOptionalRecord(event.lastCallUsage) ? { lastCallUsage: event.lastCallUsage } : {}),
    ...(cleanOptionalRecord(event.context) ? { context: event.context } : {}),
    ...(typeof event.costUsd === "number" ? { costUsd: event.costUsd } : {}),
    ...(typeof event.durationMs === "number" ? { durationMs: event.durationMs } : {}),
  };
}

function buildIngestUrl(baseUrl: string, coworkerId: string): string {
  const parsed = new URL(baseUrl);
  parsed.search = "";
  parsed.hash = "";
  const basePath = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = `${basePath}/v1/coworkers/${encodeURIComponent(coworkerId)}/observability/ingest`;
  return parsed.toString();
}

export class Oct8ObservabilityPublisher {
  private readonly timers: Oct8PublisherTimers;

  private readonly ingestUrl: string;

  private readonly queue: Oct8QueueItem[] = [];

  private flushIntervalHandle: ReturnType<typeof setInterval> | null = null;

  private retryTimerHandle: ReturnType<typeof setTimeout> | null = null;

  private flushPromise: Promise<void> | null = null;

  private stopped = false;

  private retryAttempt = 0;

  constructor(
    private readonly config: Oct8PublisherConfig,
    private readonly deps: {
      fetchFn: Oct8PublisherFetch;
      logger: Oct8PublisherLogger;
      timers?: Partial<Oct8PublisherTimers>;
    },
  ) {
    this.timers = {
      now: deps.timers?.now ?? (() => Date.now()),
      setInterval: deps.timers?.setInterval ?? setInterval,
      clearInterval: deps.timers?.clearInterval ?? clearInterval,
      setTimeout: deps.timers?.setTimeout ?? setTimeout,
      clearTimeout: deps.timers?.clearTimeout ?? clearTimeout,
    };
    this.ingestUrl = buildIngestUrl(config.baseUrl, config.coworkerId);
  }

  start(): void {
    if (this.stopped || this.flushIntervalHandle) {
      return;
    }
    this.flushIntervalHandle = this.timers.setInterval(() => {
      void this.flush();
    }, this.config.flushIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;

    if (this.flushIntervalHandle) {
      this.timers.clearInterval(this.flushIntervalHandle);
      this.flushIntervalHandle = null;
    }
    if (this.retryTimerHandle) {
      this.timers.clearTimeout(this.retryTimerHandle);
      this.retryTimerHandle = null;
    }

    if (!this.flushPromise && this.queue.length === 0) {
      return;
    }

    await Promise.race([
      this.flush({ ignoreBackoff: true, allowRetryScheduling: false }),
      sleep(this.timers, SHUTDOWN_FLUSH_TIMEOUT_MS),
    ]);
  }

  enqueueAgentEvent(event: AgentEventPayload): void {
    const mapped = mapAgentEventForOct8(event);
    if (!mapped) {
      return;
    }
    this.enqueue({ kind: "event", value: mapped });
  }

  enqueueDiagnostic(event: DiagnosticEventPayload): void {
    const mapped = mapDiagnosticEventForOct8(event);
    if (!mapped) {
      return;
    }
    this.enqueue({ kind: "diagnostic", value: mapped });
  }

  private enqueue(item: Oct8QueueItem): void {
    if (this.stopped) {
      return;
    }

    this.queue.push(item);
    if (this.queue.length > this.config.maxQueueSize) {
      const droppedCount = this.queue.length - this.config.maxQueueSize;
      this.queue.splice(0, droppedCount);
      this.deps.logger.warn(
        `diagnostics-oct8: queue capacity exceeded, dropped ${droppedCount} oldest item(s) (maxQueueSize=${this.config.maxQueueSize})`,
      );
    }

    if (this.queue.length >= this.config.maxBatchSize && !this.retryTimerHandle) {
      void this.flush();
    }
  }

  private async flush(options?: {
    ignoreBackoff?: boolean;
    allowRetryScheduling?: boolean;
  }): Promise<void> {
    if (this.flushPromise) {
      return await this.flushPromise;
    }

    this.flushPromise = this.flushLoop(options).finally(() => {
      this.flushPromise = null;
    });
    return await this.flushPromise;
  }

  private async flushLoop(options?: {
    ignoreBackoff?: boolean;
    allowRetryScheduling?: boolean;
  }): Promise<void> {
    if (!options?.ignoreBackoff && this.retryTimerHandle) {
      return;
    }

    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.config.maxBatchSize);
      const result = await this.deliverBatch(batch, {
        allowRetryScheduling: options?.allowRetryScheduling !== false,
      });

      if (result === "retry") {
        return;
      }
    }
  }

  private async deliverBatch(
    batch: Oct8QueueItem[],
    options: { allowRetryScheduling: boolean },
  ): Promise<"ok" | "retry" | "drop"> {
    const events: Oct8IngestAgentEvent[] = [];
    const diagnostics: Oct8IngestDiagnostic[] = [];

    for (const item of batch) {
      if (item.kind === "event") {
        events.push(item.value);
      } else {
        diagnostics.push(item.value);
      }
    }

    if (events.length === 0 && diagnostics.length === 0) {
      return "drop";
    }

    const controller = new AbortController();
    const timeout = this.timers.setTimeout(() => {
      controller.abort();
    }, this.config.requestTimeoutMs);

    try {
      const response = await this.deps.fetchFn(this.ingestUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.gatewayToken}`,
          "Content-Type": "application/json",
          "X-Gateway-Id": this.config.gatewayId,
          "X-Org-Id": this.config.orgId,
        },
        body: JSON.stringify({
          sourceSystem: "openclaw",
          deploymentTargetId: this.config.deploymentTargetId,
          events,
          diagnostics,
        }),
        signal: controller.signal,
      });

      if (response.ok) {
        this.retryAttempt = 0;
        return "ok";
      }

      const responseText = truncateForLog(await readResponseTextSafe(response));
      const responseSuffix = responseText ? ` body=${responseText}` : "";
      if (isTransientStatus(response.status) && options.allowRetryScheduling) {
        this.retryBatch(batch, `status=${response.status}${responseSuffix}`);
        return "retry";
      }

      this.retryAttempt = 0;
      this.deps.logger.warn(
        `diagnostics-oct8: dropping ${batch.length} queued item(s) after non-retryable ingest failure status=${response.status}${responseSuffix}`,
      );
      return "drop";
    } catch (error) {
      const reason = truncateForLog(formatError(error)) ?? "unknown error";
      if (options.allowRetryScheduling) {
        this.retryBatch(batch, reason);
        return "retry";
      }
      this.deps.logger.warn(
        `diagnostics-oct8: final flush failed for ${batch.length} queued item(s): ${reason}`,
      );
      return "drop";
    } finally {
      this.timers.clearTimeout(timeout);
    }
  }

  private retryBatch(batch: Oct8QueueItem[], reason: string): void {
    this.queue.unshift(...batch);
    const delayMs = calculateRetryDelayMs(
      this.retryAttempt,
      this.config.retryBaseMs,
      this.config.retryMaxMs,
    );
    this.retryAttempt += 1;

    if (this.retryTimerHandle) {
      return;
    }

    this.deps.logger.warn(
      `diagnostics-oct8: transient ingest failure, retrying ${batch.length} queued item(s) in ${delayMs}ms: ${reason}`,
    );
    this.retryTimerHandle = this.timers.setTimeout(() => {
      this.retryTimerHandle = null;
      void this.flush();
    }, delayMs);
  }
}
