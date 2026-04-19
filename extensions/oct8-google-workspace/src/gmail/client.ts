import { GMAIL_API_BASE } from "../constants.js";
import { ApiError, type ApiErrorCode } from "../types.js";

type FetchFn = typeof globalThis.fetch;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export type GmailThreadList = {
  threads?: GmailThreadSummary[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

export type GmailThreadSummary = {
  id: string;
  snippet: string;
  historyId: string;
};

export type GmailThread = {
  id: string;
  historyId: string;
  messages: GmailMessage[];
};

export type GmailMessageList = {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet: string;
  payload: GmailMessagePart;
  internalDate: string;
  sizeEstimate: number;
};

export type GmailMessagePart = {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers: Array<{ name: string; value: string }>;
  body: { size: number; data?: string; attachmentId?: string };
  parts?: GmailMessagePart[];
};

export type GmailDraft = {
  id: string;
  message: GmailMessage;
};

export type GmailLabel = {
  id: string;
  name: string;
  type: string;
  messageListVisibility?: string;
  labelListVisibility?: string;
};

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class GmailClient {
  private readonly fetchFn: FetchFn;

  constructor(
    private readonly accessToken: string,
    fetchFn?: FetchFn,
  ) {
    this.fetchFn = fetchFn ?? globalThis.fetch;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  async searchThreads(
    query: string,
    maxResults?: number,
    pageToken?: string,
  ): Promise<GmailThreadList> {
    const params = new URLSearchParams({ q: query });
    if (maxResults) {
      params.set("maxResults", String(maxResults));
    }
    if (pageToken) {
      params.set("pageToken", pageToken);
    }
    return this.get<GmailThreadList>(`/threads?${params}`);
  }

  async searchMessages(
    query: string,
    maxResults?: number,
    pageToken?: string,
  ): Promise<GmailMessageList> {
    const params = new URLSearchParams({ q: query });
    if (maxResults) {
      params.set("maxResults", String(maxResults));
    }
    if (pageToken) {
      params.set("pageToken", pageToken);
    }
    return this.get<GmailMessageList>(`/messages?${params}`);
  }

  async getThread(threadId: string, format?: string): Promise<GmailThread> {
    const qp = new URLSearchParams();
    if (format) {
      qp.set("format", format);
    }
    const qs = qp.toString();
    return this.get<GmailThread>(`/threads/${encodeURIComponent(threadId)}${qs ? `?${qs}` : ""}`);
  }

  async getMessage(messageId: string, format?: string): Promise<GmailMessage> {
    const qp = new URLSearchParams();
    if (format) {
      qp.set("format", format);
    }
    const qs = qp.toString();
    return this.get<GmailMessage>(
      `/messages/${encodeURIComponent(messageId)}${qs ? `?${qs}` : ""}`,
    );
  }

  async createDraft(rawMessage: string): Promise<GmailDraft> {
    return this.post<GmailDraft>("/drafts", {
      message: { raw: rawMessage },
    });
  }

  async updateDraft(draftId: string, rawMessage: string): Promise<GmailDraft> {
    return this.put<GmailDraft>(`/drafts/${encodeURIComponent(draftId)}`, {
      message: { raw: rawMessage },
    });
  }

  async sendDraft(draftId: string): Promise<GmailMessage> {
    return this.post<GmailMessage>("/drafts/send", { id: draftId });
  }

  async sendMessage(rawMessage: string): Promise<GmailMessage> {
    return this.post<GmailMessage>("/messages/send", { raw: rawMessage });
  }

  async listLabels(): Promise<GmailLabel[]> {
    const data = await this.get<{ labels: GmailLabel[] }>("/labels");
    return data.labels ?? [];
  }

  // ---------------------------------------------------------------------------
  // HTTP helpers
  // ---------------------------------------------------------------------------

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchFn(`${GMAIL_API_BASE}${path}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw await classifyError(res);
    }
    return (await res.json()) as T;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchFn(`${GMAIL_API_BASE}${path}`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw await classifyError(res);
    }
    return (await res.json()) as T;
  }

  private async put<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchFn(`${GMAIL_API_BASE}${path}`, {
      method: "PUT",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw await classifyError(res);
    }
    return (await res.json()) as T;
  }
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

async function classifyError(res: Response): Promise<ApiError> {
  const status = res.status;
  const body = await res.text().catch(() => "");
  let errorCode: string | undefined;

  try {
    const json = JSON.parse(body) as {
      error?: { errors?: Array<{ reason?: string }>; message?: string };
    };
    errorCode = json.error?.errors?.[0]?.reason;
  } catch {
    // Not JSON — use status code only
  }

  let code: ApiErrorCode;
  let retryAfter: number | undefined;

  if (status === 401) {
    code = "expired_token";
  } else if (status === 403 && errorCode === "insufficientPermissions") {
    code = "insufficient_scope";
  } else if (status === 403 && errorCode === "rateLimitExceeded") {
    code = "rate_limited";
    retryAfter = parseRetryAfter(res);
  } else if (status === 404) {
    code = "not_found";
  } else if (status === 429) {
    code = "rate_limited";
    retryAfter = parseRetryAfter(res);
  } else if (status === 403) {
    code = "forbidden";
  } else if (status >= 500) {
    code = "server_error";
  } else {
    code = "unknown";
  }

  return new ApiError(
    `Gmail API error (${status}): ${body.slice(0, 200) || res.statusText}`,
    code,
    status,
    retryAfter,
  );
}

function parseRetryAfter(res: Response): number | undefined {
  const header = res.headers.get("Retry-After");
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}
