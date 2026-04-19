/**
 * Gmail Pub/Sub Watch Service
 *
 * Provides real-time email notifications by:
 * 1. Calling Gmail users.watch API to register for push notifications
 * 2. Receiving Google Pub/Sub push messages via an HTTP route on the gateway
 * 3. Using history.list to fetch new messages since the last known historyId
 *
 * Replaces gog's `gmail watch serve` with a native implementation.
 */

import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { resolveAccessToken } from "../auth/resolve.js";
import { getServicesForKind } from "../config.js";
import { GMAIL_API_BASE } from "../constants.js";
import type { PluginConfig, ServiceEntry } from "../types.js";

type FetchFn = typeof globalThis.fetch;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WatchResponse = {
  historyId: string;
  expiration: string;
};

type HistoryMessage = {
  id: string;
  threadId: string;
};

type HistoryEntry = {
  id: string;
  messagesAdded?: Array<{ message: HistoryMessage }>;
};

type HistoryListResponse = {
  history?: HistoryEntry[];
  nextPageToken?: string;
  historyId: string;
};

type PubSubMessage = {
  message: {
    data: string;
    messageId: string;
    publishTime: string;
  };
  subscription: string;
};

type PubSubPayload = {
  emailAddress: string;
  historyId: number;
};

type WatchState = {
  historyId: string;
  expiration: number;
  email: string;
  renewTimer?: ReturnType<typeof setTimeout>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Renew watch 1 day before expiry (watches expire after 7 days). */
const RENEW_BEFORE_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** Minimum time between watch renewals to prevent tight loops. */
const MIN_RENEW_INTERVAL_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Watch state (per-email)
// ---------------------------------------------------------------------------

const watchStates = new Map<string, WatchState>();

// ---------------------------------------------------------------------------
// Gmail API calls
// ---------------------------------------------------------------------------

async function callGmailWatch(params: {
  accessToken: string;
  topicName: string;
  labelIds?: string[];
  fetchFn?: FetchFn;
}): Promise<WatchResponse> {
  const doFetch = params.fetchFn ?? globalThis.fetch;
  const res = await doFetch(`${GMAIL_API_BASE}/watch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topicName: params.topicName,
      labelIds: params.labelIds ?? ["INBOX"],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gmail watch failed (${res.status}): ${body}`);
  }

  return (await res.json()) as WatchResponse;
}

async function callGmailStop(params: { accessToken: string; fetchFn?: FetchFn }): Promise<void> {
  const doFetch = params.fetchFn ?? globalThis.fetch;
  const res = await doFetch(`${GMAIL_API_BASE}/stop`, {
    method: "POST",
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  // stop returns 204 on success; ignore errors (best effort)
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Log but don't throw — stop is best-effort
    console.warn(`[oct8-gws] Gmail stop returned ${res.status}: ${body}`);
  }
}

async function callHistoryList(params: {
  accessToken: string;
  startHistoryId: string;
  fetchFn?: FetchFn;
}): Promise<HistoryListResponse> {
  const doFetch = params.fetchFn ?? globalThis.fetch;
  const qp = new URLSearchParams({
    startHistoryId: params.startHistoryId,
    historyTypes: "messageAdded",
    labelId: "INBOX",
  });
  const res = await doFetch(`${GMAIL_API_BASE}/history?${qp}`, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gmail history.list failed (${res.status}): ${body}`);
  }

  return (await res.json()) as HistoryListResponse;
}

// ---------------------------------------------------------------------------
// Watch lifecycle
// ---------------------------------------------------------------------------

async function startWatch(params: {
  config: PluginConfig;
  entry: ServiceEntry;
  stateDir: string;
  topicName: string;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  fetchFn?: FetchFn;
}): Promise<void> {
  const { config, entry, stateDir, topicName, logger, fetchFn } = params;

  try {
    const { accessToken } = await resolveAccessToken({
      config,
      email: entry.email,
      stateDir,
      fetchFn,
    });
    const watchRes = await callGmailWatch({ accessToken, topicName, fetchFn });

    const expirationMs = Number(watchRes.expiration);
    const state: WatchState = {
      historyId: watchRes.historyId,
      expiration: expirationMs,
      email: entry.email,
    };

    // Schedule renewal before expiry
    const renewIn = Math.max(
      expirationMs - Date.now() - RENEW_BEFORE_EXPIRY_MS,
      MIN_RENEW_INTERVAL_MS,
    );
    state.renewTimer = setTimeout(() => {
      logger.info(`[oct8-gws] renewing Gmail watch for ${entry.email}`);
      void startWatch(params);
    }, renewIn);

    watchStates.set(entry.email, state);
    logger.info(
      `[oct8-gws] Gmail watch started for ${entry.email} (historyId: ${watchRes.historyId}, expires: ${new Date(expirationMs).toISOString()})`,
    );
  } catch (err) {
    logger.error(`[oct8-gws] Failed to start Gmail watch for ${entry.email}: ${String(err)}`);
  }
}

async function stopWatch(params: {
  config: PluginConfig;
  entry: ServiceEntry;
  stateDir: string;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  fetchFn?: FetchFn;
}): Promise<void> {
  const { config, entry, stateDir, logger, fetchFn } = params;
  const state = watchStates.get(entry.email);
  if (state?.renewTimer) {
    clearTimeout(state.renewTimer);
  }
  watchStates.delete(entry.email);

  try {
    const { accessToken } = await resolveAccessToken({
      config,
      email: entry.email,
      stateDir,
      fetchFn,
    });
    await callGmailStop({ accessToken, fetchFn });
    logger.info(`[oct8-gws] Gmail watch stopped for ${entry.email}`);
  } catch (err) {
    logger.warn(`[oct8-gws] Failed to stop Gmail watch for ${entry.email}: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Pub/Sub push handler
// ---------------------------------------------------------------------------

function createPushHandler(params: {
  config: PluginConfig;
  stateDir: string;
  pushSecret: string;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  onNewMessages?: (email: string, messageIds: string[]) => void;
  fetchFn?: FetchFn;
}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> {
  const { config, stateDir, pushSecret, logger, onNewMessages, fetchFn } = params;

  return async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end("Method Not Allowed");
      return true;
    }

    // Verify push secret from query parameter
    const reqUrl = new URL(req.url ?? "/", "http://localhost");
    const token = reqUrl.searchParams.get("token");
    if (!token || token !== pushSecret) {
      logger.warn("[oct8-gws] Pub/Sub push rejected: invalid or missing token");
      res.writeHead(403);
      res.end("Forbidden");
      return true;
    }

    // Read body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks).toString("utf-8");

    let pubsubMsg: PubSubMessage;
    try {
      pubsubMsg = JSON.parse(body) as PubSubMessage;
    } catch {
      res.writeHead(400);
      res.end("Invalid JSON");
      return true;
    }

    // Decode Pub/Sub data
    let payload: PubSubPayload;
    try {
      const decoded = Buffer.from(pubsubMsg.message.data, "base64").toString("utf-8");
      payload = JSON.parse(decoded) as PubSubPayload;
    } catch {
      res.writeHead(400);
      res.end("Invalid Pub/Sub payload");
      return true;
    }

    // Acknowledge immediately (Google requires 2xx within ~20s)
    res.writeHead(200);
    res.end("OK");

    const email = payload.emailAddress;
    const newHistoryId = String(payload.historyId);
    const state = watchStates.get(email);

    if (!state) {
      logger.warn(`[oct8-gws] Pub/Sub push for unknown email: ${email}`);
      return true;
    }

    // Fetch history since last known historyId
    const mailEntries = getServicesForKind(config, "mail");
    const entry = mailEntries.find((s) => s.entry.email === email)?.entry;
    if (!entry) {
      logger.warn(`[oct8-gws] No mail service for ${email}`);
      return true;
    }

    try {
      const { accessToken } = await resolveAccessToken({
        config,
        email: entry.email,
        stateDir,
        fetchFn,
      });
      const history = await callHistoryList({
        accessToken,
        startHistoryId: state.historyId,
        fetchFn,
      });

      // Extract new message IDs
      const messageIds: string[] = [];
      for (const h of history.history ?? []) {
        for (const added of h.messagesAdded ?? []) {
          messageIds.push(added.message.id);
        }
      }

      // Update historyId
      state.historyId = history.historyId || newHistoryId;

      if (messageIds.length > 0) {
        logger.info(`[oct8-gws] ${messageIds.length} new message(s) for ${email}`);
        onNewMessages?.(email, messageIds);
      }
    } catch (err) {
      logger.error(`[oct8-gws] History fetch failed for ${email}: ${String(err)}`);
    }

    return true;
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register the Gmail watch service and HTTP push endpoint.
 * Only activates when pubsub is enabled in config and mail services exist.
 */
export function registerGmailWatchService(
  api: OpenClawPluginApi,
  config: PluginConfig,
  stateDir: string,
): void {
  const pubsub = config.pubsub;
  if (!pubsub?.enabled || !pubsub.gcpProject) {
    return;
  }

  const mailEntries = getServicesForKind(config, "mail");
  if (mailEntries.length === 0) {
    return;
  }

  const topicName = `projects/${pubsub.gcpProject}/topics/${pubsub.topic ?? "oct8-gmail-watch"}`;

  // Generate a random push secret for this gateway session — prevents spoofed Pub/Sub messages
  const pushSecret = randomBytes(24).toString("hex");

  // Register the HTTP push endpoint
  api.registerHttpRoute({
    path: "/oct8/gmail/notify",
    auth: "gateway",
    handler: createPushHandler({
      config,
      stateDir,
      pushSecret,
      logger: api.logger,
      onNewMessages: (email, messageIds) => {
        // Trigger a hook event for new email — other plugins or the agent can handle it
        api.registerHook("oct8:gmail:new-messages", () => {
          api.logger.info(`[oct8-gws] New messages for ${email}: ${messageIds.join(", ")}`);
        });
      },
    }),
  });

  // Register the background service for watch lifecycle
  api.registerService({
    id: "oct8-gmail-watch",
    start: async (ctx) => {
      // Deduplicate: one watch per unique email across all mail entries
      const seen = new Set<string>();
      for (const { entry } of mailEntries) {
        if (seen.has(entry.email)) {
          continue;
        }
        seen.add(entry.email);

        await startWatch({
          config,
          entry,
          stateDir: ctx.stateDir,
          topicName,
          logger: ctx.logger,
        });
      }
    },
    stop: async (ctx) => {
      const seen = new Set<string>();
      for (const { entry } of mailEntries) {
        if (seen.has(entry.email)) {
          continue;
        }
        seen.add(entry.email);

        await stopWatch({
          config,
          entry,
          stateDir: ctx.stateDir,
          logger: ctx.logger,
        });
      }
    },
  });
}

/** Expose for testing. */
export { callGmailWatch, callGmailStop, callHistoryList, createPushHandler, watchStates };
