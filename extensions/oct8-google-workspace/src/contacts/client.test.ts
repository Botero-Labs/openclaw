import { describe, expect, it } from "vitest";
import { PEOPLE_API_BASE } from "../constants.js";
import { ApiError } from "../types.js";
import { ContactsClient } from "./client.js";

type Call = { url: string; init: RequestInit };

function requestUrl(url: string | URL | Request): string {
  if (typeof url === "string") {
    return url;
  }
  if (url instanceof URL) {
    return url.toString();
  }
  return url.url;
}

function createMockClient(
  responseBody: unknown,
  status = 200,
): { client: ContactsClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: requestUrl(url), init: init ?? {} });
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { client: new ContactsClient("test-token", fetchFn), calls };
}

function createErrorClient(status: number, body: unknown): ContactsClient {
  const fetchFn = (async () =>
    new Response(JSON.stringify(body), { status })) as typeof globalThis.fetch;
  return new ContactsClient("test-token", fetchFn);
}

describe("ContactsClient", () => {
  it("listContacts sends GET to connections endpoint", async () => {
    const { client, calls } = createMockClient({ connections: [] });
    await client.listContacts({ pageSize: 50 });
    expect(calls[0].url).toContain(`${PEOPLE_API_BASE}/people/me/connections`);
    expect(calls[0].url).toContain("pageSize=50");
    expect(calls[0].url).toContain("personFields=");
  });

  it("searchContacts sends query with readMask", async () => {
    const { client, calls } = createMockClient({ results: [] });
    await client.searchContacts("John", 10);
    expect(calls[0].url).toContain("people:searchContacts");
    expect(calls[0].url).toContain("query=John");
    expect(calls[0].url).toContain("readMask=");
  });

  it("searchContacts caps pageSize at 30", async () => {
    const { client, calls } = createMockClient({ results: [] });
    await client.searchContacts("test", 100);
    expect(calls[0].url).toContain("pageSize=30");
  });

  it("getContact fetches by resourceName", async () => {
    const person = { resourceName: "people/c123", names: [{ displayName: "John" }] };
    const { client, calls } = createMockClient(person);
    const result = await client.getContact("people/c123");
    expect(result.resourceName).toBe("people/c123");
    expect(calls[0].url).toContain("/people/c123");
  });

  it("createContact sends POST", async () => {
    const { client, calls } = createMockClient({ resourceName: "people/c456" });
    await client.createContact({ names: [{ givenName: "Jane" }] });
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].url).toContain("createContact");
  });

  it("updateContact sends PATCH with updatePersonFields", async () => {
    const { client, calls } = createMockClient({ resourceName: "people/c123" });
    await client.updateContact({
      resourceName: "people/c123",
      person: { names: [{ givenName: "Updated" }] },
      updatePersonFields: "names",
    });
    expect(calls[0].init.method).toBe("PATCH");
    expect(calls[0].url).toContain("updatePersonFields=names");
  });

  it("classifies 401 as expired_token", async () => {
    const client = createErrorClient(401, {});
    const err = await client.listContacts().catch((e) => e);
    expect((err as ApiError).code).toBe("expired_token");
  });

  it("classifies 400 as invalid_request", async () => {
    const client = createErrorClient(400, { error: { message: "bad" } });
    const err = await client.listContacts().catch((e) => e);
    expect((err as ApiError).code).toBe("invalid_request");
  });
});
