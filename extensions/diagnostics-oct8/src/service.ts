import type {
  OpenClawConfig,
  OpenClawPluginService,
  OpenClawPluginServiceContext,
} from "../api.js";
import {
  onAgentEvent,
  onDiagnosticEvent,
  resolveGatewayAuth,
  type ResolvedGatewayAuth,
} from "../api.js";
import {
  Oct8ObservabilityPublisher,
  OCT8_MAX_BATCH_SIZE,
  type Oct8PublisherConfig,
  type Oct8PublisherFetch,
} from "./publisher.js";

const DEFAULT_FLUSH_INTERVAL_MS = 1_000;
const DEFAULT_MAX_BATCH_SIZE = 100;
const DEFAULT_MAX_QUEUE_SIZE = 2_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 30_000;

type MinimalLogger = Pick<
  OpenClawPluginServiceContext["logger"],
  "debug" | "info" | "warn" | "error"
>;

export type DiagnosticsOct8ResolvedConfig = Oct8PublisherConfig;

export type DiagnosticsOct8ServiceDeps = {
  fetchFn?: Oct8PublisherFetch;
  onAgentEventFn?: typeof onAgentEvent;
  onDiagnosticEventFn?: typeof onDiagnosticEvent;
  resolveGatewayAuthFn?: typeof resolveGatewayAuth;
  publisherFactory?: (params: {
    config: DiagnosticsOct8ResolvedConfig;
    logger: MinimalLogger;
    fetchFn: Oct8PublisherFetch;
  }) => Pick<
    Oct8ObservabilityPublisher,
    "start" | "stop" | "enqueueAgentEvent" | "enqueueDiagnostic"
  >;
};

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString();
}

export function resolveDiagnosticsOct8Config(params: {
  config: OpenClawConfig;
  logger: Pick<MinimalLogger, "warn">;
  env?: NodeJS.ProcessEnv;
  resolveGatewayAuthFn?: DiagnosticsOct8ServiceDeps["resolveGatewayAuthFn"];
}): DiagnosticsOct8ResolvedConfig | null {
  const diagnostics = params.config.diagnostics;
  const oct8 = diagnostics?.oct8;

  if (!diagnostics?.enabled || !oct8?.enabled) {
    return null;
  }

  const baseUrl = cleanString(oct8.baseUrl);
  const orgId = cleanString(oct8.orgId);
  const coworkerId = cleanString(oct8.coworkerId);
  const gatewayId = cleanString(oct8.gatewayId);
  const deploymentTargetId = cleanString(oct8.deploymentTargetId);

  const missingFields = [
    !baseUrl ? "diagnostics.oct8.baseUrl" : null,
    !orgId ? "diagnostics.oct8.orgId" : null,
    !coworkerId ? "diagnostics.oct8.coworkerId" : null,
    !gatewayId ? "diagnostics.oct8.gatewayId" : null,
    !deploymentTargetId ? "diagnostics.oct8.deploymentTargetId" : null,
  ].filter(Boolean);

  if (missingFields.length > 0) {
    params.logger.warn(
      `diagnostics-oct8: disabled because required config is missing: ${missingFields.join(", ")}`,
    );
    return null;
  }

  const resolvedAuth = (params.resolveGatewayAuthFn ?? resolveGatewayAuth)({
    authConfig: params.config.gateway?.auth,
    env: params.env ?? process.env,
    tailscaleMode: params.config.gateway?.tailscale?.mode,
  });
  const gatewayToken = resolvedAuth.mode === "token" ? cleanString(resolvedAuth.token) : undefined;
  if (!gatewayToken) {
    params.logger.warn(
      "diagnostics-oct8: disabled because the current gateway auth does not resolve to a bearer token.",
    );
    return null;
  }

  return {
    baseUrl: normalizeBaseUrl(baseUrl!),
    orgId: orgId!,
    coworkerId: coworkerId!,
    gatewayId: gatewayId!,
    deploymentTargetId: deploymentTargetId!,
    gatewayToken,
    flushIntervalMs: oct8.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
    maxBatchSize: Math.min(oct8.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE, OCT8_MAX_BATCH_SIZE),
    maxQueueSize: oct8.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE,
    requestTimeoutMs: oct8.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    retryBaseMs: oct8.retryBaseMs ?? DEFAULT_RETRY_BASE_MS,
    retryMaxMs: Math.max(
      oct8.retryMaxMs ?? DEFAULT_RETRY_MAX_MS,
      oct8.retryBaseMs ?? DEFAULT_RETRY_BASE_MS,
    ),
  };
}

export function createDiagnosticsOct8Service(
  deps: DiagnosticsOct8ServiceDeps = {},
): OpenClawPluginService {
  let unsubscribeAgent: (() => void) | null = null;
  let unsubscribeDiagnostic: (() => void) | null = null;
  let publisher: Pick<
    Oct8ObservabilityPublisher,
    "start" | "stop" | "enqueueAgentEvent" | "enqueueDiagnostic"
  > | null = null;

  return {
    id: "diagnostics-oct8",
    async start(ctx) {
      if (publisher) {
        return;
      }

      const resolved = resolveDiagnosticsOct8Config({
        config: ctx.config,
        logger: ctx.logger,
        resolveGatewayAuthFn: deps.resolveGatewayAuthFn,
      });
      if (!resolved) {
        return;
      }

      const fetchFn = deps.fetchFn ?? fetch;
      const publisherFactory =
        deps.publisherFactory ??
        ((params: {
          config: DiagnosticsOct8ResolvedConfig;
          logger: MinimalLogger;
          fetchFn: Oct8PublisherFetch;
        }) =>
          new Oct8ObservabilityPublisher(params.config, {
            fetchFn: params.fetchFn,
            logger: params.logger,
          }));

      publisher = publisherFactory({
        config: resolved,
        logger: ctx.logger,
        fetchFn,
      });

      try {
        unsubscribeAgent = (deps.onAgentEventFn ?? onAgentEvent)((event) => {
          publisher?.enqueueAgentEvent(event);
        });
        unsubscribeDiagnostic = (deps.onDiagnosticEventFn ?? onDiagnosticEvent)((event) => {
          publisher?.enqueueDiagnostic(event);
        });
        publisher.start();
      } catch (error) {
        unsubscribeAgent?.();
        unsubscribeAgent = null;
        unsubscribeDiagnostic?.();
        unsubscribeDiagnostic = null;
        publisher = null;
        throw error;
      }

      ctx.logger.info(`diagnostics-oct8: publishing coworker observability to ${resolved.baseUrl}`);
    },
    async stop() {
      unsubscribeAgent?.();
      unsubscribeAgent = null;

      unsubscribeDiagnostic?.();
      unsubscribeDiagnostic = null;

      if (!publisher) {
        return;
      }

      const activePublisher = publisher;
      publisher = null;
      await activePublisher.stop();
    },
  };
}
