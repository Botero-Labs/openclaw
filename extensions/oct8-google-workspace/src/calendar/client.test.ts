import { describe, expect, it } from "vitest";
import { CALENDAR_API_BASE } from "../constants.js";
import { ApiError } from "../types.js";
import { CalendarClient } from "./client.js";

type Call = { url: string; init: RequestInit };

function createMockClient(
  responseBody: unknown,
  status = 200,
  headers?: Record<string, string>,
): { client: CalendarClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }) as typeof globalThis.fetch;
  return { client: new CalendarClient("test-token", fetchFn), calls };
}

function createDeleteClient(status = 204): { client: CalendarClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status });
  }) as typeof globalThis.fetch;
  return { client: new CalendarClient("test-token", fetchFn), calls };
}

function createErrorClient(
  status: number,
  errorBody: unknown,
  headers?: Record<string, string>,
): CalendarClient {
  const fetchFn = (async () =>
    new Response(JSON.stringify(errorBody), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    })) as typeof globalThis.fetch;
  return new CalendarClient("test-token", fetchFn);
}

describe("CalendarClient", () => {
  describe("listCalendars", () => {
    it("sends GET to calendarList endpoint", async () => {
      const { client, calls } = createMockClient({ kind: "calendar#calendarList", items: [] });
      await client.listCalendars();
      expect(calls[0]!.url).toBe(`${CALENDAR_API_BASE}/users/me/calendarList`);
    });

    it("passes maxResults and pageToken", async () => {
      const { client, calls } = createMockClient({ kind: "calendar#calendarList", items: [] });
      await client.listCalendars(50, "next-page");
      expect(calls[0]!.url).toContain("maxResults=50");
      expect(calls[0]!.url).toContain("pageToken=next-page");
    });

    it("includes Authorization header", async () => {
      const { client, calls } = createMockClient({ kind: "calendar#calendarList", items: [] });
      await client.listCalendars();
      expect((calls[0]!.init.headers as Record<string, string>)["Authorization"]).toBe(
        "Bearer test-token",
      );
    });
  });

  describe("listEvents", () => {
    it("sends correct parameters", async () => {
      const { client, calls } = createMockClient({ kind: "calendar#events", items: [] });
      await client.listEvents({
        calendarId: "primary",
        timeMin: "2026-04-01T00:00:00Z",
        timeMax: "2026-04-07T23:59:59Z",
        timeZone: "America/New_York",
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 20,
      });

      const url = calls[0]!.url;
      expect(url).toContain("/calendars/primary/events?");
      expect(url).toContain("timeMin=2026-04-01T00%3A00%3A00Z");
      expect(url).toContain("timeMax=2026-04-07T23%3A59%3A59Z");
      expect(url).toContain("timeZone=America%2FNew_York");
      expect(url).toContain("singleEvents=true");
      expect(url).toContain("orderBy=startTime");
      expect(url).toContain("maxResults=20");
    });

    it("URL-encodes calendarId", async () => {
      const { client, calls } = createMockClient({ kind: "calendar#events", items: [] });
      await client.listEvents({ calendarId: "user@example.com" });
      expect(calls[0]!.url).toContain("/calendars/user%40example.com/events");
    });

    it("includes free text search parameter", async () => {
      const { client, calls } = createMockClient({ kind: "calendar#events", items: [] });
      await client.listEvents({ calendarId: "primary", q: "standup meeting" });
      expect(calls[0]!.url).toContain("q=standup+meeting");
    });
  });

  describe("getEvent", () => {
    it("fetches event by ID with timezone", async () => {
      const event = { id: "ev-1", status: "confirmed", start: {}, end: {} };
      const { client, calls } = createMockClient(event);
      const result = await client.getEvent({
        calendarId: "primary",
        eventId: "ev-1",
        timeZone: "Europe/London",
      });
      expect(result.id).toBe("ev-1");
      expect(calls[0]!.url).toContain("timeZone=Europe%2FLondon");
    });
  });

  describe("createEvent", () => {
    it("sends POST with event body and sendUpdates", async () => {
      const { client, calls } = createMockClient({ id: "new-ev", status: "confirmed" });
      await client.createEvent({
        calendarId: "primary",
        event: {
          summary: "Team standup",
          start: { dateTime: "2026-04-01T09:00:00-04:00" },
          end: { dateTime: "2026-04-01T09:30:00-04:00" },
        },
        sendUpdates: "none",
      });

      expect(calls[0]!.init.method).toBe("POST");
      expect(calls[0]!.url).toContain("sendUpdates=none");
      const body = JSON.parse(calls[0]!.init.body as string);
      expect(body.summary).toBe("Team standup");
    });

    it("creates all-day event with date fields", async () => {
      const { client, calls } = createMockClient({ id: "allday-ev" });
      await client.createEvent({
        calendarId: "primary",
        event: {
          summary: "Vacation",
          start: { date: "2026-04-10" },
          end: { date: "2026-04-15" },
        },
      });
      const body = JSON.parse(calls[0]!.init.body as string);
      expect(body.start.date).toBe("2026-04-10");
      expect(body.end.date).toBe("2026-04-15");
      expect(body.start.dateTime).toBeUndefined();
    });
  });

  describe("updateEvent", () => {
    it("sends PUT with full event body", async () => {
      const { client, calls } = createMockClient({ id: "ev-1", status: "confirmed" });
      await client.updateEvent({
        calendarId: "primary",
        eventId: "ev-1",
        event: {
          summary: "Updated standup",
          start: { dateTime: "2026-04-01T10:00:00-04:00" },
          end: { dateTime: "2026-04-01T10:30:00-04:00" },
        },
        sendUpdates: "all",
      });

      expect(calls[0]!.init.method).toBe("PUT");
      expect(calls[0]!.url).toContain("/events/ev-1");
      expect(calls[0]!.url).toContain("sendUpdates=all");
    });
  });

  describe("deleteEvent", () => {
    it("sends DELETE and returns void on 204", async () => {
      const { client, calls } = createDeleteClient(204);
      await client.deleteEvent({
        calendarId: "primary",
        eventId: "ev-1",
        sendUpdates: "none",
      });
      expect(calls[0]!.init.method).toBe("DELETE");
      expect(calls[0]!.url).toContain("/events/ev-1");
      expect(calls[0]!.url).toContain("sendUpdates=none");
    });

    it("throws on error response", async () => {
      const client = createErrorClient(404, { error: { message: "not found" } });
      await expect(
        client.deleteEvent({ calendarId: "primary", eventId: "gone" }),
      ).rejects.toThrow();
    });
  });

  describe("freeBusy", () => {
    it("sends POST with items and time range", async () => {
      const { client, calls } = createMockClient({
        kind: "calendar#freeBusy",
        timeMin: "2026-04-01T00:00:00Z",
        timeMax: "2026-04-02T00:00:00Z",
        calendars: {
          primary: { busy: [{ start: "2026-04-01T09:00:00Z", end: "2026-04-01T10:00:00Z" }] },
        },
      });

      const result = await client.freeBusy({
        timeMin: "2026-04-01T00:00:00Z",
        timeMax: "2026-04-02T00:00:00Z",
        items: [{ id: "primary" }],
      });

      expect(calls[0]!.init.method).toBe("POST");
      expect(calls[0]!.url).toContain("/freeBusy");
      expect(result.calendars["primary"]!.busy).toHaveLength(1);
    });

    it("rejects more than 50 calendars", async () => {
      const { client } = createMockClient({});
      const items = Array.from({ length: 51 }, (_, i) => ({ id: `cal-${i}` }));
      await expect(client.freeBusy({ timeMin: "a", timeMax: "b", items })).rejects.toThrow(
        "maximum of 50",
      );
    });

    it("passes timeZone parameter", async () => {
      const { client, calls } = createMockClient({ kind: "calendar#freeBusy", calendars: {} });
      await client.freeBusy({
        timeMin: "2026-04-01T00:00:00Z",
        timeMax: "2026-04-02T00:00:00Z",
        timeZone: "America/Chicago",
        items: [{ id: "primary" }],
      });
      const body = JSON.parse(calls[0]!.init.body as string);
      expect(body.timeZone).toBe("America/Chicago");
    });
  });

  describe("error classification", () => {
    it("classifies 401 as expired_token", async () => {
      const client = createErrorClient(401, { error: { message: "invalid" } });
      const err = await client.listCalendars().catch((e) => e);
      expect((err as ApiError).code).toBe("expired_token");
    });

    it("classifies 403 + rateLimitExceeded as rate_limited", async () => {
      const client = createErrorClient(403, {
        error: { errors: [{ reason: "rateLimitExceeded" }] },
      });
      const err = await client.listCalendars().catch((e) => e);
      expect((err as ApiError).code).toBe("rate_limited");
    });

    it("classifies 403 + userRateLimitExceeded as rate_limited", async () => {
      const client = createErrorClient(403, {
        error: { errors: [{ reason: "userRateLimitExceeded" }] },
      });
      const err = await client.listCalendars().catch((e) => e);
      expect((err as ApiError).code).toBe("rate_limited");
    });

    it("classifies 403 + calendarUsageLimitsExceeded as rate_limited", async () => {
      const client = createErrorClient(403, {
        error: { errors: [{ reason: "calendarUsageLimitsExceeded" }] },
      });
      const err = await client.listCalendars().catch((e) => e);
      expect((err as ApiError).code).toBe("rate_limited");
    });

    it("classifies 400 as invalid_request", async () => {
      const client = createErrorClient(400, { error: { message: "bad request" } });
      const err = await client.listCalendars().catch((e) => e);
      expect((err as ApiError).code).toBe("invalid_request");
    });

    it("classifies 500 as server_error", async () => {
      const client = createErrorClient(500, {});
      const err = await client.listCalendars().catch((e) => e);
      expect((err as ApiError).code).toBe("server_error");
    });
  });
});
