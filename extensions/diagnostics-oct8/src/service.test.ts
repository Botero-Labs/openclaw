import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentEventPayload,
  DiagnosticEventPayload,
  OpenClawPluginServiceContext,
} from "../api.js";
import { createDiagnosticsOct8Service, resolveDiagnosticsOct8Config } from "./service.js";

type RegisteredHandlers = {
  agent: ((event: AgentEventPayload) => void) | null;
  diagnostic: ((event: DiagnosticEventPayload) => void) | null;
};

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createContext(
  overrides: Partial<OpenClawPluginServiceContext["config"]> = {},
): OpenClawPluginServiceContext {
  return {
    config: {
      diagnostics: {
        enabled: true,
        oct8: {
          enabled: true,
          baseUrl: "https://oct8.example.com/platform",
          orgId: "11111111-1111-4111-8111-111111111111",
          coworkerId: "22222222-2222-4222-8222-222222222222",
          gatewayId: "33333333-3333-4333-8333-333333333333",
          deploymentTargetId: "44444444-4444-4444-8444-444444444444",
        },
      },
      gateway: {
        auth: {
          mode: "token",
        },
      },
      ...overrides,
    },
    logger: createLogger(),
    stateDir: "/tmp/openclaw-diagnostics-oct8-test",
    workspaceDir: "/tmp/openclaw-diagnostics-oct8-test/workspace",
  };
}

describe("diagnostics-oct8 service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts only when diagnostics and diagnostics.oct8 are enabled", async () => {
    const handlers: RegisteredHandlers = { agent: null, diagnostic: null };
    const unsubscribeAgent = vi.fn();
    const unsubscribeDiagnostic = vi.fn();
    const onAgentEventFn = vi.fn((listener: (event: AgentEventPayload) => void) => {
      handlers.agent = listener;
      return unsubscribeAgent;
    });
    const onDiagnosticEventFn = vi.fn((listener: (event: DiagnosticEventPayload) => void) => {
      handlers.diagnostic = listener;
      return unsubscribeDiagnostic;
    });

    const disabledService = createDiagnosticsOct8Service({
      onAgentEventFn,
      onDiagnosticEventFn,
      resolveGatewayAuthFn: () => ({
        mode: "token",
        token: "gateway-token",
        allowTailscale: false,
      }),
    });
    const disabledCtx = createContext({
      diagnostics: {
        enabled: false,
        oct8: { enabled: true },
      },
    });
    await disabledService.start(disabledCtx);

    expect(onAgentEventFn).not.toHaveBeenCalled();
    expect(onDiagnosticEventFn).not.toHaveBeenCalled();

    const enabledService = createDiagnosticsOct8Service({
      onAgentEventFn,
      onDiagnosticEventFn,
      resolveGatewayAuthFn: () => ({
        mode: "token",
        token: "gateway-token",
        allowTailscale: false,
      }),
    });
    const enabledCtx = createContext();
    await enabledService.start(enabledCtx);

    expect(onAgentEventFn).toHaveBeenCalledTimes(1);
    expect(onDiagnosticEventFn).toHaveBeenCalledTimes(1);
    await enabledService.stop?.(enabledCtx);
  });

  it("subscribes, batches mapped payloads, excludes assistant deltas, and unsubscribes on stop", async () => {
    const handlers: RegisteredHandlers = { agent: null, diagnostic: null };
    const unsubscribeAgent = vi.fn();
    const unsubscribeDiagnostic = vi.fn();
    const onAgentEventFn = vi.fn((listener: (event: AgentEventPayload) => void) => {
      handlers.agent = listener;
      return unsubscribeAgent;
    });
    const onDiagnosticEventFn = vi.fn((listener: (event: DiagnosticEventPayload) => void) => {
      handlers.diagnostic = listener;
      return unsubscribeDiagnostic;
    });
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const service = createDiagnosticsOct8Service({
      fetchFn,
      onAgentEventFn,
      onDiagnosticEventFn,
      resolveGatewayAuthFn: () => ({
        mode: "token",
        token: "gateway-token",
        allowTailscale: false,
      }),
    });
    const ctx = createContext();

    await service.start(ctx);
    expect(handlers.agent).toBeTypeOf("function");
    expect(handlers.diagnostic).toBeTypeOf("function");

    handlers.agent?.({
      runId: "run-1",
      seq: 1,
      stream: "assistant",
      ts: 1000,
      data: { delta: "ignore me" },
    });
    handlers.agent?.({
      runId: "run-1",
      seq: 2,
      stream: "lifecycle",
      ts: 1001,
      sessionKey: "agent:main:main",
      data: { phase: "start" },
    });
    handlers.agent?.({
      runId: "run-1",
      seq: 3,
      stream: "tool",
      ts: 1002,
      sessionKey: "agent:main:main",
      data: { phase: "result", name: "read", toolCallId: "tool-1", isError: false },
    });
    handlers.agent?.({
      runId: "run-1",
      seq: 4,
      stream: "compaction",
      ts: 1003,
      sessionKey: "agent:main:main",
      data: { phase: "end", completed: true, willRetry: false },
    });
    handlers.diagnostic?.({
      type: "model.usage",
      runId: "run-1",
      seq: 10,
      ts: 1004,
      sessionKey: "agent:main:main",
      provider: "anthropic",
      model: "claude-sonnet",
      usage: { total: 42 },
      costUsd: 0.12,
    });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://oct8.example.com/platform/v1/coworkers/22222222-2222-4222-8222-222222222222/observability/ingest",
    );
    expect(init.headers).toMatchObject({
      Authorization: "Bearer gateway-token",
      "Content-Type": "application/json",
      "X-Gateway-Id": "33333333-3333-4333-8333-333333333333",
      "X-Org-Id": "11111111-1111-4111-8111-111111111111",
    });

    const body = JSON.parse(String(init.body)) as {
      sourceSystem: string;
      deploymentTargetId: string;
      events: Array<{ stream: string; seq: number }>;
      diagnostics: Array<{ type: string; runId?: string }>;
    };
    expect(body).toMatchObject({
      sourceSystem: "openclaw",
      deploymentTargetId: "44444444-4444-4444-8444-444444444444",
    });
    expect(body.events).toEqual([
      expect.objectContaining({ stream: "lifecycle", seq: 2 }),
      expect.objectContaining({ stream: "tool", seq: 3 }),
      expect.objectContaining({ stream: "compaction", seq: 4 }),
    ]);
    expect(body.events.some((event) => event.stream === "assistant")).toBe(false);
    expect(body.diagnostics).toEqual([
      expect.objectContaining({ type: "model.usage", runId: "run-1" }),
    ]);

    await service.stop?.(ctx);
    expect(unsubscribeAgent).toHaveBeenCalledTimes(1);
    expect(unsubscribeDiagnostic).toHaveBeenCalledTimes(1);
  });

  it("retries transient ingest failures with backoff and never throws from bus callbacks", async () => {
    const handlers: RegisteredHandlers = { agent: null, diagnostic: null };
    const onAgentEventFn = vi.fn((listener: (event: AgentEventPayload) => void) => {
      handlers.agent = listener;
      return vi.fn();
    });
    const onDiagnosticEventFn = vi.fn((listener: (event: DiagnosticEventPayload) => void) => {
      handlers.diagnostic = listener;
      return vi.fn();
    });
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("temporary outage", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const service = createDiagnosticsOct8Service({
      fetchFn,
      onAgentEventFn,
      onDiagnosticEventFn,
      resolveGatewayAuthFn: () => ({
        mode: "token",
        token: "gateway-token",
        allowTailscale: false,
      }),
    });
    const ctx = createContext({
      diagnostics: {
        enabled: true,
        oct8: {
          enabled: true,
          baseUrl: "https://oct8.example.com",
          orgId: "11111111-1111-4111-8111-111111111111",
          coworkerId: "22222222-2222-4222-8222-222222222222",
          gatewayId: "33333333-3333-4333-8333-333333333333",
          deploymentTargetId: "44444444-4444-4444-8444-444444444444",
          flushIntervalMs: 100,
          retryBaseMs: 250,
          retryMaxMs: 1_000,
        },
      },
    });

    await service.start(ctx);

    expect(() =>
      handlers.agent?.({
        runId: "run-retry",
        seq: 1,
        stream: "lifecycle",
        ts: 1000,
        data: { phase: "start" },
      }),
    ).not.toThrow();

    await vi.advanceTimersByTimeAsync(100);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("transient ingest failure, retrying 1 queued item(s) in 250ms"),
    );

    await vi.advanceTimersByTimeAsync(249);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    await service.stop?.(ctx);
  });

  it("cleans up pending timers on shutdown with a best-effort final flush", async () => {
    const handlers: RegisteredHandlers = { agent: null, diagnostic: null };
    const onAgentEventFn = vi.fn((listener: (event: AgentEventPayload) => void) => {
      handlers.agent = listener;
      return vi.fn();
    });
    const onDiagnosticEventFn = vi.fn((listener: (event: DiagnosticEventPayload) => void) => {
      handlers.diagnostic = listener;
      return vi.fn();
    });
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const service = createDiagnosticsOct8Service({
      fetchFn,
      onAgentEventFn,
      onDiagnosticEventFn,
      resolveGatewayAuthFn: () => ({
        mode: "token",
        token: "gateway-token",
        allowTailscale: false,
      }),
    });
    const ctx = createContext({
      diagnostics: {
        enabled: true,
        oct8: {
          enabled: true,
          baseUrl: "https://oct8.example.com",
          orgId: "11111111-1111-4111-8111-111111111111",
          coworkerId: "22222222-2222-4222-8222-222222222222",
          gatewayId: "33333333-3333-4333-8333-333333333333",
          deploymentTargetId: "44444444-4444-4444-8444-444444444444",
          flushIntervalMs: 10_000,
        },
      },
    });

    await service.start(ctx);
    handlers.agent?.({
      runId: "run-stop",
      seq: 1,
      stream: "lifecycle",
      ts: 1000,
      data: { phase: "start" },
    });

    await service.stop?.(ctx);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("resolves sane runtime defaults for diagnostics.oct8", () => {
    const logger = createLogger();
    const resolved = resolveDiagnosticsOct8Config({
      config: createContext().config,
      logger,
      resolveGatewayAuthFn: () => ({
        mode: "token",
        token: "gateway-token",
        allowTailscale: false,
      }),
    });

    expect(resolved).toMatchObject({
      flushIntervalMs: 1_000,
      maxBatchSize: 100,
      maxQueueSize: 2_000,
      requestTimeoutMs: 5_000,
      retryBaseMs: 1_000,
      retryMaxMs: 30_000,
      gatewayToken: "gateway-token",
    });
  });
});
