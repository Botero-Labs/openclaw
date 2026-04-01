import { type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { GMAIL_API_BASE } from "../constants.js";
import {
  callGmailStop,
  callGmailWatch,
  callHistoryList,
  createPushHandler,
  watchStates,
} from "./watch.js";

type Call = { url: string; init: RequestInit };

function mockFetchFn(
  responseBody: unknown,
  status = 200,
): { fetchFn: typeof globalThis.fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(responseBody), { status });
  }) as typeof globalThis.fetch;
  return { fetchFn, calls };
}

const TEST_PUSH_SECRET = "test-push-secret-abc123";

afterEach(() => {
  for (const [, state] of watchStates) {
    if (state.renewTimer) clearTimeout(state.renewTimer);
  }
  watchStates.clear();
});

describe("callGmailWatch", () => {
  it("sends POST to /watch with topic and labels", async () => {
    const { fetchFn, calls } = mockFetchFn({
      historyId: "12345",
      expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const result = await callGmailWatch({
      accessToken: "test-token",
      topicName: "projects/my-project/topics/oct8-gmail-watch",
      fetchFn,
    });

    expect(result.historyId).toBe("12345");
    expect(calls[0]!.url).toBe(`${GMAIL_API_BASE}/watch`);
    expect(calls[0]!.init.method).toBe("POST");

    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.topicName).toBe("projects/my-project/topics/oct8-gmail-watch");
    expect(body.labelIds).toEqual(["INBOX"]);
  });

  it("throws on error response", async () => {
    const { fetchFn } = mockFetchFn("error", 403);
    await expect(
      callGmailWatch({ accessToken: "bad", topicName: "topic", fetchFn }),
    ).rejects.toThrow("Gmail watch failed (403)");
  });
});

describe("callGmailStop", () => {
  it("sends POST to /stop", async () => {
    const calls: Call[] = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 204 });
    }) as typeof globalThis.fetch;

    await callGmailStop({ accessToken: "test-token", fetchFn });
    expect(calls[0]!.url).toBe(`${GMAIL_API_BASE}/stop`);
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("does not throw on error (best-effort)", async () => {
    const fetchFn = (async () => new Response("error", { status: 400 })) as typeof globalThis.fetch;
    await expect(callGmailStop({ accessToken: "test", fetchFn })).resolves.toBeUndefined();
  });
});

describe("callHistoryList", () => {
  it("fetches history since startHistoryId", async () => {
    const { fetchFn, calls } = mockFetchFn({
      history: [{ id: "100", messagesAdded: [{ message: { id: "msg-1", threadId: "t-1" } }] }],
      historyId: "101",
    });

    const result = await callHistoryList({
      accessToken: "test-token",
      startHistoryId: "99",
      fetchFn,
    });

    expect(result.history).toHaveLength(1);
    expect(result.historyId).toBe("101");
    expect(calls[0]!.url).toContain("startHistoryId=99");
    expect(calls[0]!.url).toContain("historyTypes=messageAdded");
  });
});

describe("createPushHandler", () => {
  function createMockReqRes(
    method: string,
    body: string,
    urlPath = `/oct8/gmail/notify?token=${TEST_PUSH_SECRET}`,
  ) {
    const req = {
      method,
      url: urlPath,
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(body);
      },
    } as unknown as IncomingMessage;

    let statusCode = 0;
    let responseBody = "";
    const res = {
      writeHead: (code: number) => {
        statusCode = code;
      },
      end: (b?: string) => {
        responseBody = b ?? "";
      },
    } as unknown as ServerResponse;

    return { req, res, getStatus: () => statusCode, getBody: () => responseBody };
  }

  function makePubSubBody(email: string, historyId: number): string {
    const payload = JSON.stringify({ emailAddress: email, historyId });
    const data = Buffer.from(payload).toString("base64");
    return JSON.stringify({
      message: { data, messageId: "msg-123", publishTime: new Date().toISOString() },
      subscription: "projects/my-project/subscriptions/oct8-gmail-watch-push",
    });
  }

  it("rejects non-POST requests", async () => {
    const handler = createPushHandler({
      config: { services: {} },
      stateDir: "/tmp",
      pushSecret: TEST_PUSH_SECRET,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const { req, res, getStatus } = createMockReqRes("GET", "");
    await handler(req, res);
    expect(getStatus()).toBe(405);
  });

  it("rejects requests with missing push secret", async () => {
    const handler = createPushHandler({
      config: { services: {} },
      stateDir: "/tmp",
      pushSecret: TEST_PUSH_SECRET,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const { req, res, getStatus } = createMockReqRes("POST", "{}", "/oct8/gmail/notify");
    await handler(req, res);
    expect(getStatus()).toBe(403);
  });

  it("rejects requests with wrong push secret", async () => {
    const handler = createPushHandler({
      config: { services: {} },
      stateDir: "/tmp",
      pushSecret: TEST_PUSH_SECRET,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const { req, res, getStatus } = createMockReqRes(
      "POST",
      "{}",
      "/oct8/gmail/notify?token=wrong-secret",
    );
    await handler(req, res);
    expect(getStatus()).toBe(403);
  });

  it("rejects invalid JSON body", async () => {
    const handler = createPushHandler({
      config: { services: {} },
      stateDir: "/tmp",
      pushSecret: TEST_PUSH_SECRET,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const { req, res, getStatus } = createMockReqRes("POST", "not json{{{");
    await handler(req, res);
    expect(getStatus()).toBe(400);
  });

  it("returns 200 for valid push message with correct secret", async () => {
    watchStates.set("albus@diagon.com", {
      historyId: "100",
      expiration: Date.now() + 7 * 24 * 60 * 60 * 1000,
      email: "albus@diagon.com",
    });

    const { fetchFn } = mockFetchFn({
      history: [{ id: "101", messagesAdded: [{ message: { id: "msg-new", threadId: "t-1" } }] }],
      historyId: "102",
    });

    const handler = createPushHandler({
      config: {
        services: {
          "albus-mail": { service: "mail", email: "albus@diagon.com", mode: "agent_owned" },
        },
        credentials: {
          clientId: "cid",
          clientSecret: "csec",
          refreshToken: "rt",
          email: "albus@diagon.com",
        },
      },
      stateDir: "/tmp",
      pushSecret: TEST_PUSH_SECRET,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      fetchFn,
    });

    const body = makePubSubBody("albus@diagon.com", 101);
    const { req, res, getStatus } = createMockReqRes("POST", body);
    await handler(req, res);
    expect(getStatus()).toBe(200);
  });

  it("warns for unknown email in push message", async () => {
    const warnings: string[] = [];
    const handler = createPushHandler({
      config: { services: {} },
      stateDir: "/tmp",
      pushSecret: TEST_PUSH_SECRET,
      logger: { info: () => {}, warn: (m: string) => warnings.push(m), error: () => {} },
    });

    const body = makePubSubBody("unknown@example.com", 100);
    const { req, res } = createMockReqRes("POST", body);
    await handler(req, res);
    expect(warnings.some((w) => w.includes("unknown email"))).toBe(true);
  });
});
