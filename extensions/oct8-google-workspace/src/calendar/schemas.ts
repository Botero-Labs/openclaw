import { Type } from "@sinclair/typebox";

function stringEnum<T extends readonly string[]>(values: T, description: string) {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], description });
}

export const CalendarListCalendarsSchema = Type.Object(
  {
    maxResults: Type.Optional(
      Type.Number({ description: "Max calendars to return (1-250)", minimum: 1, maximum: 250 }),
    ),
    pageToken: Type.Optional(Type.String({ description: "Page token for pagination" })),
  },
  { additionalProperties: false },
);

export const CalendarListEventsSchema = Type.Object(
  {
    calendarId: Type.Optional(Type.String({ description: 'Calendar ID (default: "primary")' })),
    timeMin: Type.Optional(
      Type.String({ description: "Start of time range (RFC3339, e.g. 2026-04-01T00:00:00Z)" }),
    ),
    timeMax: Type.Optional(Type.String({ description: "End of time range (RFC3339)" })),
    timeZone: Type.Optional(
      Type.String({ description: "IANA timezone for response (e.g. America/New_York)" }),
    ),
    q: Type.Optional(
      Type.String({
        description: "Free text search across summary, description, location, attendees",
      }),
    ),
    maxResults: Type.Optional(
      Type.Number({ description: "Max events to return (1-2500)", minimum: 1, maximum: 2500 }),
    ),
    pageToken: Type.Optional(Type.String({ description: "Page token for pagination" })),
  },
  { additionalProperties: false },
);

export const CalendarGetEventSchema = Type.Object(
  {
    calendarId: Type.Optional(Type.String({ description: 'Calendar ID (default: "primary")' })),
    eventId: Type.String({ description: "Event ID" }),
    timeZone: Type.Optional(Type.String({ description: "IANA timezone for response" })),
  },
  { additionalProperties: false },
);

export const CalendarCreateEventSchema = Type.Object(
  {
    calendarId: Type.Optional(Type.String({ description: 'Calendar ID (default: "primary")' })),
    summary: Type.String({ description: "Event title" }),
    startDateTime: Type.Optional(
      Type.String({
        description: "Start time (RFC3339 for timed events, e.g. 2026-04-01T09:00:00-04:00)",
      }),
    ),
    endDateTime: Type.Optional(Type.String({ description: "End time (RFC3339 for timed events)" })),
    startDate: Type.Optional(
      Type.String({ description: "Start date for all-day events (yyyy-mm-dd)" }),
    ),
    endDate: Type.Optional(
      Type.String({ description: "End date for all-day events (yyyy-mm-dd, exclusive)" }),
    ),
    timeZone: Type.Optional(
      Type.String({ description: "IANA timezone (required for recurring events)" }),
    ),
    description: Type.Optional(Type.String({ description: "Event description (supports HTML)" })),
    location: Type.Optional(Type.String({ description: "Geographic location" })),
    attendees: Type.Optional(
      Type.Array(Type.String({ description: "Attendee email address" }), {
        description: "List of attendee emails",
      }),
    ),
    recurrence: Type.Optional(
      Type.Array(Type.String(), {
        description: "Recurrence rules (RRULE format, e.g. RRULE:FREQ=WEEKLY;COUNT=10)",
      }),
    ),
    colorId: Type.Optional(Type.String({ description: "Event color ID (1-11)" })),
    transparency: Type.Optional(
      stringEnum(
        ["opaque", "transparent"] as const,
        "Whether event blocks time (opaque) or not (transparent)",
      ),
    ),
    visibility: Type.Optional(
      stringEnum(["default", "public", "private", "confidential"] as const, "Event visibility"),
    ),
  },
  { additionalProperties: false },
);

export const CalendarUpdateEventSchema = Type.Object(
  {
    calendarId: Type.Optional(Type.String({ description: 'Calendar ID (default: "primary")' })),
    eventId: Type.String({ description: "Event ID to update" }),
    summary: Type.Optional(Type.String({ description: "Updated event title" })),
    startDateTime: Type.Optional(Type.String({ description: "Updated start time (RFC3339)" })),
    endDateTime: Type.Optional(Type.String({ description: "Updated end time (RFC3339)" })),
    startDate: Type.Optional(
      Type.String({ description: "Updated start date for all-day (yyyy-mm-dd)" }),
    ),
    endDate: Type.Optional(
      Type.String({ description: "Updated end date for all-day (yyyy-mm-dd)" }),
    ),
    timeZone: Type.Optional(Type.String({ description: "IANA timezone" })),
    description: Type.Optional(Type.String({ description: "Updated description" })),
    location: Type.Optional(Type.String({ description: "Updated location" })),
    attendees: Type.Optional(
      Type.Array(Type.String(), { description: "Updated attendee emails (replaces existing)" }),
    ),
    colorId: Type.Optional(Type.String({ description: "Updated color ID" })),
    transparency: Type.Optional(
      stringEnum(["opaque", "transparent"] as const, "Updated transparency"),
    ),
    visibility: Type.Optional(
      stringEnum(["default", "public", "private", "confidential"] as const, "Updated visibility"),
    ),
  },
  { additionalProperties: false },
);

export const CalendarDeleteEventSchema = Type.Object(
  {
    calendarId: Type.Optional(Type.String({ description: 'Calendar ID (default: "primary")' })),
    eventId: Type.String({ description: "Event ID to delete" }),
  },
  { additionalProperties: false },
);

export const CalendarCheckAvailabilitySchema = Type.Object(
  {
    timeMin: Type.String({ description: "Start of time range (RFC3339)" }),
    timeMax: Type.String({ description: "End of time range (RFC3339)" }),
    timeZone: Type.Optional(Type.String({ description: "IANA timezone (default: UTC)" })),
    calendars: Type.Array(Type.String({ description: "Calendar ID or email" }), {
      description: "Calendar IDs to check (max 50)",
    }),
  },
  { additionalProperties: false },
);
