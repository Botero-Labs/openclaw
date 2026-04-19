import { CALENDAR_API_BASE } from "../constants.js";
import { ApiError, type ApiErrorCode } from "../types.js";

type FetchFn = typeof globalThis.fetch;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export type CalendarListEntry = {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  timeZone: string;
  colorId?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  accessRole: "freeBusyReader" | "reader" | "writer" | "owner";
  primary?: boolean;
  hidden?: boolean;
  selected?: boolean;
};

export type CalendarListResponse = {
  kind: string;
  items: CalendarListEntry[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

export type EventTime = {
  /** All-day: yyyy-mm-dd */
  date?: string;
  /** Timed: RFC3339 with timezone offset */
  dateTime?: string;
  /** IANA timezone (e.g. "America/New_York") */
  timeZone?: string;
};

export type EventAttendee = {
  email: string;
  displayName?: string;
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
  optional?: boolean;
  organizer?: boolean;
  self?: boolean;
};

export type CalendarEvent = {
  id: string;
  status: string;
  summary?: string;
  description?: string;
  location?: string;
  start: EventTime;
  end: EventTime;
  created: string;
  updated: string;
  creator?: { email: string; displayName?: string };
  organizer?: { email: string; displayName?: string };
  attendees?: EventAttendee[];
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: EventTime;
  transparency?: "opaque" | "transparent";
  visibility?: "default" | "public" | "private" | "confidential";
  colorId?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: Record<string, unknown>;
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{ method: string; minutes: number }>;
  };
  eventType?: string;
};

export type EventListResponse = {
  kind: string;
  summary: string;
  description?: string;
  timeZone: string;
  accessRole: string;
  items: CalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

export type FreeBusyResponse = {
  kind: string;
  timeMin: string;
  timeMax: string;
  calendars: Record<
    string,
    {
      busy: Array<{ start: string; end: string }>;
      errors?: Array<{ domain: string; reason: string }>;
    }
  >;
  groups?: Record<
    string,
    {
      calendars: string[];
      errors?: Array<{ domain: string; reason: string }>;
    }
  >;
};

export type EventInput = {
  summary?: string;
  description?: string;
  location?: string;
  start: EventTime;
  end: EventTime;
  attendees?: Array<{ email: string; optional?: boolean }>;
  recurrence?: string[];
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{ method: string; minutes: number }>;
  };
  colorId?: string;
  transparency?: "opaque" | "transparent";
  visibility?: "default" | "public" | "private" | "confidential";
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanSeeOtherGuests?: boolean;
};

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class CalendarClient {
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

  // --- CalendarList ---

  async listCalendars(maxResults?: number, pageToken?: string): Promise<CalendarListResponse> {
    const params = new URLSearchParams();
    if (maxResults) {
      params.set("maxResults", String(maxResults));
    }
    if (pageToken) {
      params.set("pageToken", pageToken);
    }
    const qs = params.toString();
    return this.get<CalendarListResponse>(
      `${CALENDAR_API_BASE}/users/me/calendarList${qs ? `?${qs}` : ""}`,
    );
  }

  // --- Events ---

  async listEvents(params: {
    calendarId: string;
    timeMin?: string;
    timeMax?: string;
    timeZone?: string;
    singleEvents?: boolean;
    orderBy?: "startTime" | "updated";
    maxResults?: number;
    pageToken?: string;
    q?: string;
  }): Promise<EventListResponse> {
    const qp = new URLSearchParams();
    if (params.timeMin) {
      qp.set("timeMin", params.timeMin);
    }
    if (params.timeMax) {
      qp.set("timeMax", params.timeMax);
    }
    if (params.timeZone) {
      qp.set("timeZone", params.timeZone);
    }
    if (params.singleEvents !== undefined) {
      qp.set("singleEvents", String(params.singleEvents));
    }
    if (params.orderBy) {
      qp.set("orderBy", params.orderBy);
    }
    if (params.maxResults) {
      qp.set("maxResults", String(params.maxResults));
    }
    if (params.pageToken) {
      qp.set("pageToken", params.pageToken);
    }
    if (params.q) {
      qp.set("q", params.q);
    }
    const qs = qp.toString();
    const calId = encodeURIComponent(params.calendarId);
    return this.get<EventListResponse>(
      `${CALENDAR_API_BASE}/calendars/${calId}/events${qs ? `?${qs}` : ""}`,
    );
  }

  async getEvent(params: {
    calendarId: string;
    eventId: string;
    timeZone?: string;
  }): Promise<CalendarEvent> {
    const qp = new URLSearchParams();
    if (params.timeZone) {
      qp.set("timeZone", params.timeZone);
    }
    const qs = qp.toString();
    const calId = encodeURIComponent(params.calendarId);
    const evId = encodeURIComponent(params.eventId);
    return this.get<CalendarEvent>(
      `${CALENDAR_API_BASE}/calendars/${calId}/events/${evId}${qs ? `?${qs}` : ""}`,
    );
  }

  async createEvent(params: {
    calendarId: string;
    event: EventInput;
    sendUpdates?: "all" | "externalOnly" | "none";
  }): Promise<CalendarEvent> {
    const qp = new URLSearchParams();
    if (params.sendUpdates) {
      qp.set("sendUpdates", params.sendUpdates);
    }
    const qs = qp.toString();
    const calId = encodeURIComponent(params.calendarId);
    return this.post<CalendarEvent>(
      `${CALENDAR_API_BASE}/calendars/${calId}/events${qs ? `?${qs}` : ""}`,
      params.event,
    );
  }

  /**
   * Update an event. Uses PUT (full replacement).
   * Caller should GET the event first, merge changes, then pass the full resource.
   */
  async updateEvent(params: {
    calendarId: string;
    eventId: string;
    event: EventInput;
    sendUpdates?: "all" | "externalOnly" | "none";
  }): Promise<CalendarEvent> {
    const qp = new URLSearchParams();
    if (params.sendUpdates) {
      qp.set("sendUpdates", params.sendUpdates);
    }
    const qs = qp.toString();
    const calId = encodeURIComponent(params.calendarId);
    const evId = encodeURIComponent(params.eventId);
    return this.put<CalendarEvent>(
      `${CALENDAR_API_BASE}/calendars/${calId}/events/${evId}${qs ? `?${qs}` : ""}`,
      params.event,
    );
  }

  async deleteEvent(params: {
    calendarId: string;
    eventId: string;
    sendUpdates?: "all" | "externalOnly" | "none";
  }): Promise<void> {
    const qp = new URLSearchParams();
    if (params.sendUpdates) {
      qp.set("sendUpdates", params.sendUpdates);
    }
    const qs = qp.toString();
    const calId = encodeURIComponent(params.calendarId);
    const evId = encodeURIComponent(params.eventId);
    const res = await this.fetchFn(
      `${CALENDAR_API_BASE}/calendars/${calId}/events/${evId}${qs ? `?${qs}` : ""}`,
      { method: "DELETE", headers: this.headers() },
    );
    if (!res.ok) {
      throw await classifyError(res);
    }
  }

  // --- FreeBusy ---

  async freeBusy(params: {
    timeMin: string;
    timeMax: string;
    timeZone?: string;
    items: Array<{ id: string }>;
  }): Promise<FreeBusyResponse> {
    if (params.items.length > 50) {
      throw new ApiError(
        "FreeBusy query supports a maximum of 50 calendars.",
        "invalid_request",
        400,
      );
    }
    return this.post<FreeBusyResponse>(`${CALENDAR_API_BASE}/freeBusy`, {
      timeMin: params.timeMin,
      timeMax: params.timeMax,
      timeZone: params.timeZone,
      items: params.items,
    });
  }

  // ---------------------------------------------------------------------------
  // HTTP helpers
  // ---------------------------------------------------------------------------

  private async get<T>(url: string): Promise<T> {
    const res = await this.fetchFn(url, { headers: this.headers() });
    if (!res.ok) {
      throw await classifyError(res);
    }
    return (await res.json()) as T;
  }

  private async post<T>(url: string, body: unknown): Promise<T> {
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw await classifyError(res);
    }
    return (await res.json()) as T;
  }

  private async put<T>(url: string, body: unknown): Promise<T> {
    const res = await this.fetchFn(url, {
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
// Error classification — same pattern as Gmail
// ---------------------------------------------------------------------------

async function classifyError(res: Response): Promise<ApiError> {
  const status = res.status;
  const body = await res.text().catch(() => "");
  let errorReason: string | undefined;

  try {
    const json = JSON.parse(body) as {
      error?: { errors?: Array<{ reason?: string }>; message?: string };
    };
    errorReason = json.error?.errors?.[0]?.reason;
  } catch {
    // Not JSON
  }

  let code: ApiErrorCode;
  let retryAfter: number | undefined;

  if (status === 401) {
    code = "expired_token";
  } else if (
    status === 403 &&
    (errorReason === "rateLimitExceeded" ||
      errorReason === "userRateLimitExceeded" ||
      errorReason === "calendarUsageLimitsExceeded")
  ) {
    code = "rate_limited";
    retryAfter = parseRetryAfter(res);
  } else if (status === 403 && errorReason === "insufficientPermissions") {
    code = "insufficient_scope";
  } else if (status === 404) {
    code = "not_found";
  } else if (status === 429) {
    code = "rate_limited";
    retryAfter = parseRetryAfter(res);
  } else if (status === 403) {
    code = "forbidden";
  } else if (status >= 500) {
    code = "server_error";
  } else if (status === 400) {
    code = "invalid_request";
  } else {
    code = "unknown";
  }

  return new ApiError(
    `Calendar API error (${status}): ${body.slice(0, 200) || res.statusText}`,
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
