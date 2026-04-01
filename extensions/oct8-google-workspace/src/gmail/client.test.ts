import { describe, expect, it } from "vitest";
import { GMAIL_API_BASE } from "../constants.js";
import { ApiError } from "../types.js";
import { GmailClient } from "./client.js";

type Call = { url: string; init: RequestInit };

function createMockClient(
  responseBody: unknown,
  status = 200,
  headers?: Record<string, string>,
): { client: GmailClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }) as typeof globalThis.fetch;

  return { client: new GmailClient("test-access-token", fetchFn), calls };
}

function createErrorClient(
  status: number,
  errorBody: unknown,
  headers?: Record<string, string>,
): GmailClient {
  const fetchFn = (async () =>
    new Response(JSON.stringify(errorBody), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    })) as typeof globalThis.fetch;
  return new GmailClient("test-token", fetchFn);
}

describe("GmailClient", () => {
  describe("searchThreads", () => {
    it("sends correct query parameter", async () => {
      const { client, calls } = createMockClient({ threads: [], resultSizeEstimate: 0 });
      await client.searchThreads("is:unread newer_than:1d");

      expect(calls[0]!.url).toContain(`${GMAIL_API_BASE}/threads?`);
      expect(calls[0]!.url).toContain("q=is%3Aunread+newer_than%3A1d");
    });

    it("includes maxResults and pageToken", async () => {
      const { client, calls } = createMockClient({ threads: [] });
      await client.searchThreads("from:boss", 10, "next-page-token");

      expect(calls[0]!.url).toContain("maxResults=10");
      expect(calls[0]!.url).toContain("pageToken=next-page-token");
    });

    it("includes Authorization header", async () => {
      const { client, calls } = createMockClient({ threads: [] });
      await client.searchThreads("test");

      expect((calls[0]!.init.headers as Record<string, string>)["Authorization"]).toBe(
        "Bearer test-access-token",
      );
    });
  });

  describe("getThread", () => {
    it("fetches thread by ID", async () => {
      const thread = { id: "thread-1", historyId: "123", messages: [] };
      const { client, calls } = createMockClient(thread);
      const result = await client.getThread("thread-1");

      expect(result.id).toBe("thread-1");
      expect(calls[0]!.url).toBe(`${GMAIL_API_BASE}/threads/thread-1`);
    });

    it("passes format parameter", async () => {
      const { client, calls } = createMockClient({ id: "t", historyId: "1", messages: [] });
      await client.getThread("thread-1", "metadata");

      expect(calls[0]!.url).toContain("format=metadata");
    });
  });

  describe("getMessage", () => {
    it("fetches message by ID", async () => {
      const msg = {
        id: "msg-1",
        threadId: "t-1",
        snippet: "hi",
        payload: {},
        internalDate: "0",
        sizeEstimate: 0,
      };
      const { client } = createMockClient(msg);
      const result = await client.getMessage("msg-1");

      expect(result.id).toBe("msg-1");
    });
  });

  describe("searchMessages", () => {
    it("sends query to messages endpoint", async () => {
      const { client, calls } = createMockClient({ messages: [] });
      await client.searchMessages("from:alice@example.com", 5);

      expect(calls[0]!.url).toContain(`${GMAIL_API_BASE}/messages?`);
      expect(calls[0]!.url).toContain("maxResults=5");
    });
  });

  describe("createDraft", () => {
    it("sends POST with raw message", async () => {
      const { client, calls } = createMockClient({ id: "draft-1", message: {} });
      await client.createDraft("base64url-encoded-message");

      expect(calls[0]!.init.method).toBe("POST");
      expect(calls[0]!.url).toContain("/drafts");
      const body = JSON.parse(calls[0]!.init.body as string);
      expect(body.message.raw).toBe("base64url-encoded-message");
    });
  });

  describe("updateDraft", () => {
    it("sends PUT with raw message", async () => {
      const { client, calls } = createMockClient({ id: "draft-1", message: {} });
      await client.updateDraft("draft-1", "updated-raw");

      expect(calls[0]!.init.method).toBe("PUT");
      expect(calls[0]!.url).toContain("/drafts/draft-1");
    });
  });

  describe("sendDraft", () => {
    it("sends POST to drafts/send", async () => {
      const { client, calls } = createMockClient({ id: "msg-1", threadId: "t-1" });
      await client.sendDraft("draft-1");

      expect(calls[0]!.init.method).toBe("POST");
      expect(calls[0]!.url).toContain("/drafts/send");
      const body = JSON.parse(calls[0]!.init.body as string);
      expect(body.id).toBe("draft-1");
    });
  });

  describe("sendMessage", () => {
    it("sends POST to messages/send", async () => {
      const { client, calls } = createMockClient({ id: "msg-1" });
      await client.sendMessage("raw-message");

      expect(calls[0]!.url).toContain("/messages/send");
      const body = JSON.parse(calls[0]!.init.body as string);
      expect(body.raw).toBe("raw-message");
    });
  });

  describe("listLabels", () => {
    it("returns label list", async () => {
      const { client } = createMockClient({
        labels: [
          { id: "INBOX", name: "INBOX", type: "system" },
          { id: "Label_1", name: "Work", type: "user" },
        ],
      });
      const labels = await client.listLabels();

      expect(labels).toHaveLength(2);
      expect(labels[0]!.name).toBe("INBOX");
    });
  });

  describe("error classification", () => {
    it("classifies 401 as expired_token", async () => {
      const client = createErrorClient(401, { error: { message: "invalid" } });
      const err = await client.searchThreads("test").catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("expired_token");
    });

    it("classifies 403 + insufficientPermissions as insufficient_scope", async () => {
      const client = createErrorClient(403, {
        error: { errors: [{ reason: "insufficientPermissions" }] },
      });
      const err = await client.searchThreads("test").catch((e) => e);
      expect((err as ApiError).code).toBe("insufficient_scope");
    });

    it("classifies 403 + rateLimitExceeded as rate_limited", async () => {
      const client = createErrorClient(
        403,
        { error: { errors: [{ reason: "rateLimitExceeded" }] } },
        { "Retry-After": "30" },
      );
      const err = await client.searchThreads("test").catch((e) => e);
      expect((err as ApiError).code).toBe("rate_limited");
      expect((err as ApiError).retryAfter).toBe(30);
    });

    it("classifies 404 as not_found", async () => {
      const client = createErrorClient(404, { error: { message: "not found" } });
      const err = await client.getThread("nonexistent").catch((e) => e);
      expect((err as ApiError).code).toBe("not_found");
    });

    it("classifies 429 as rate_limited", async () => {
      const client = createErrorClient(429, {}, { "Retry-After": "60" });
      const err = await client.searchThreads("test").catch((e) => e);
      expect((err as ApiError).code).toBe("rate_limited");
      expect((err as ApiError).retryAfter).toBe(60);
    });

    it("classifies 500 as server_error", async () => {
      const client = createErrorClient(500, { error: { message: "internal" } });
      const err = await client.searchThreads("test").catch((e) => e);
      expect((err as ApiError).code).toBe("server_error");
    });

    it("classifies other 403 as forbidden", async () => {
      const client = createErrorClient(403, { error: { message: "forbidden" } });
      const err = await client.searchThreads("test").catch((e) => e);
      expect((err as ApiError).code).toBe("forbidden");
    });
  });
});
