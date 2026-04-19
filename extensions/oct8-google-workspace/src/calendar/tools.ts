import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { resolveAccessToken } from "../auth/resolve.js";
import { getServicesForKind } from "../config.js";
import { checkPolicy } from "../policy.js";
import type { ApiError, PluginConfig, ServiceEntry } from "../types.js";
import { CalendarClient, type EventInput, type EventTime } from "./client.js";
import {
  CalendarCheckAvailabilitySchema,
  CalendarCreateEventSchema,
  CalendarDeleteEventSchema,
  CalendarGetEventSchema,
  CalendarListCalendarsSchema,
  CalendarListEventsSchema,
  CalendarUpdateEventSchema,
} from "./schemas.js";

type TextContent = { type: "text"; text: string };
type ToolResult = { content: TextContent[]; details: unknown };

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], details: undefined };
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text: `Error: ${text}` }], details: undefined };
}

function formatApiError(err: ApiError): ToolResult {
  const retryHint = err.retryAfter ? ` Retry after ${err.retryAfter}s.` : "";
  return errorResult(`Calendar API error (${err.code}): ${err.message}${retryHint}`);
}

function resolveCalendarEntry(
  config: PluginConfig,
  agentId: string | undefined,
): { id: string; entry: ServiceEntry } | undefined {
  const services = getServicesForKind(config, "calendar");
  for (const svc of services) {
    const agents = svc.entry.allowedAgents;
    if (!agents || agents.length === 0 || (agentId !== undefined && agents.includes(agentId))) {
      return svc;
    }
  }
  return undefined;
}

/** Build EventTime from user params — handles both all-day and timed events. */
function buildEventTime(dateTime?: string, date?: string, timeZone?: string): EventTime {
  if (date) {
    return { date, timeZone };
  }
  return { dateTime, timeZone };
}

/**
 * Determine sendUpdates based on mode.
 * delegated_human → "none" (human controls notifications)
 * agent_owned → "all" (agent has full autonomy)
 */
function resolveSendUpdates(mode: ServiceEntry["mode"]): "all" | "none" {
  return mode === "delegated_human" ? "none" : "all";
}

export function registerCalendarTools(
  api: OpenClawPluginApi,
  config: PluginConfig,
  stateDir: string,
): void {
  const calendarServices = getServicesForKind(config, "calendar");
  if (calendarServices.length === 0) {
    return;
  }

  // --- calendar_list_calendars ---
  api.registerTool((ctx) => ({
    name: "calendar_list_calendars",
    label: "List calendars",
    description: "List all calendars the coworker has access to",
    parameters: CalendarListCalendarsSchema,
    async execute(_id: string, params: { maxResults?: number; pageToken?: string }) {
      const resolved = resolveCalendarEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No calendar service configured for this agent.");
      }
      const policy = checkPolicy({
        config,
        serviceKind: "calendar",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "list_calendars",
      });
      if (!policy.allowed) {
        return errorResult(policy.reason);
      }
      try {
        const { accessToken } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const client = new CalendarClient(accessToken);
        const result = await client.listCalendars(params.maxResults, params.pageToken);
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        if ((err as ApiError).code) {
          return formatApiError(err as ApiError);
        }
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  // --- calendar_list_events ---
  api.registerTool((ctx) => ({
    name: "calendar_list_events",
    label: "List calendar events",
    description: "List events from a calendar within a time range",
    parameters: CalendarListEventsSchema,
    async execute(
      _id: string,
      params: {
        calendarId?: string;
        timeMin?: string;
        timeMax?: string;
        timeZone?: string;
        q?: string;
        maxResults?: number;
        pageToken?: string;
      },
    ) {
      const resolved = resolveCalendarEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No calendar service configured for this agent.");
      }
      const policy = checkPolicy({
        config,
        serviceKind: "calendar",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "list_events",
      });
      if (!policy.allowed) {
        return errorResult(policy.reason);
      }
      try {
        const { accessToken } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const client = new CalendarClient(accessToken);
        const result = await client.listEvents({
          calendarId: params.calendarId ?? "primary",
          timeMin: params.timeMin,
          timeMax: params.timeMax,
          timeZone: params.timeZone,
          singleEvents: true,
          orderBy: "startTime",
          maxResults: params.maxResults,
          pageToken: params.pageToken,
          q: params.q,
        });
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        if ((err as ApiError).code) {
          return formatApiError(err as ApiError);
        }
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  // --- calendar_get_event ---
  api.registerTool((ctx) => ({
    name: "calendar_get_event",
    label: "Get calendar event",
    description: "Fetch a single calendar event by ID",
    parameters: CalendarGetEventSchema,
    async execute(
      _id: string,
      params: { calendarId?: string; eventId: string; timeZone?: string },
    ) {
      const resolved = resolveCalendarEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No calendar service configured for this agent.");
      }
      const policy = checkPolicy({
        config,
        serviceKind: "calendar",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "get_event",
      });
      if (!policy.allowed) {
        return errorResult(policy.reason);
      }
      try {
        const { accessToken } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const client = new CalendarClient(accessToken);
        const result = await client.getEvent({
          calendarId: params.calendarId ?? "primary",
          eventId: params.eventId,
          timeZone: params.timeZone,
        });
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        if ((err as ApiError).code) {
          return formatApiError(err as ApiError);
        }
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  // --- calendar_create_event ---
  api.registerTool((ctx) => ({
    name: "calendar_create_event",
    label: "Create calendar event",
    description: "Create a new calendar event",
    parameters: CalendarCreateEventSchema,
    async execute(
      _id: string,
      params: {
        calendarId?: string;
        summary: string;
        startDateTime?: string;
        endDateTime?: string;
        startDate?: string;
        endDate?: string;
        timeZone?: string;
        description?: string;
        location?: string;
        attendees?: string[];
        recurrence?: string[];
        colorId?: string;
        transparency?: "opaque" | "transparent";
        visibility?: "default" | "public" | "private" | "confidential";
      },
    ) {
      const resolved = resolveCalendarEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No calendar service configured for this agent.");
      }
      const policy = checkPolicy({
        config,
        serviceKind: "calendar",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "create_event",
      });
      if (!policy.allowed) {
        return errorResult(policy.reason);
      }

      // Defense in depth: strip attendees in delegated_human mode to prevent invitation side-effects
      if (resolved.entry.mode === "delegated_human" && params.attendees?.length) {
        return errorResult(
          "Adding attendees is not allowed in delegated_human mode. Create the event without attendees and let the calendar owner add them.",
        );
      }

      // Validate: must have either dateTime pair or date pair
      const hasTimedStart = !!params.startDateTime;
      const hasAllDayStart = !!params.startDate;
      if (!hasTimedStart && !hasAllDayStart) {
        return errorResult(
          "Provide either startDateTime (for timed events) or startDate (for all-day events).",
        );
      }
      if (hasTimedStart && hasAllDayStart) {
        return errorResult("Cannot mix startDateTime and startDate. Use one format consistently.");
      }

      try {
        const { accessToken } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const event: EventInput = {
          summary: params.summary,
          start: buildEventTime(params.startDateTime, params.startDate, params.timeZone),
          end: buildEventTime(params.endDateTime, params.endDate, params.timeZone),
          description: params.description,
          location: params.location,
          attendees: params.attendees?.map((email) => ({ email })),
          recurrence: params.recurrence,
          colorId: params.colorId,
          transparency: params.transparency,
          visibility: params.visibility,
        };
        const client = new CalendarClient(accessToken);
        const result = await client.createEvent({
          calendarId: params.calendarId ?? "primary",
          event,
          sendUpdates: resolveSendUpdates(resolved.entry.mode),
        });
        return textResult(
          JSON.stringify(
            { eventId: result.id, htmlLink: result.htmlLink, summary: result.summary },
            null,
            2,
          ),
        );
      } catch (err) {
        if ((err as ApiError).code) {
          return formatApiError(err as ApiError);
        }
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  // --- calendar_update_event ---
  api.registerTool((ctx) => ({
    name: "calendar_update_event",
    label: "Update calendar event",
    description: "Update an existing calendar event (fetches current event, merges changes, saves)",
    parameters: CalendarUpdateEventSchema,
    async execute(
      _id: string,
      params: {
        calendarId?: string;
        eventId: string;
        summary?: string;
        startDateTime?: string;
        endDateTime?: string;
        startDate?: string;
        endDate?: string;
        timeZone?: string;
        description?: string;
        location?: string;
        attendees?: string[];
        colorId?: string;
        transparency?: "opaque" | "transparent";
        visibility?: "default" | "public" | "private" | "confidential";
      },
    ) {
      const resolved = resolveCalendarEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No calendar service configured for this agent.");
      }
      const policy = checkPolicy({
        config,
        serviceKind: "calendar",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "update_event",
      });
      if (!policy.allowed) {
        return errorResult(policy.reason);
      }

      // Defense in depth: block attendee modification in delegated_human mode
      if (resolved.entry.mode === "delegated_human" && params.attendees !== undefined) {
        return errorResult(
          "Modifying attendees is not allowed in delegated_human mode. Let the calendar owner manage attendees.",
        );
      }

      try {
        const { accessToken } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const client = new CalendarClient(accessToken);
        const calId = params.calendarId ?? "primary";

        // GET current event to merge (PUT is full replacement)
        const current = await client.getEvent({ calendarId: calId, eventId: params.eventId });

        // Merge changes onto current event
        const merged: EventInput = {
          summary: params.summary ?? current.summary,
          description: params.description ?? current.description,
          location: params.location ?? current.location,
          start:
            params.startDateTime || params.startDate
              ? buildEventTime(params.startDateTime, params.startDate, params.timeZone)
              : current.start,
          end:
            params.endDateTime || params.endDate
              ? buildEventTime(params.endDateTime, params.endDate, params.timeZone)
              : current.end,
          attendees: params.attendees
            ? params.attendees.map((email) => ({ email }))
            : current.attendees?.map((a) => ({ email: a.email, optional: a.optional })),
          colorId: params.colorId ?? current.colorId,
          transparency: params.transparency ?? current.transparency,
          visibility: params.visibility ?? current.visibility,
          recurrence: current.recurrence,
          reminders: current.reminders,
        };

        const result = await client.updateEvent({
          calendarId: calId,
          eventId: params.eventId,
          event: merged,
          sendUpdates: resolveSendUpdates(resolved.entry.mode),
        });
        return textResult(
          JSON.stringify(
            { eventId: result.id, summary: result.summary, updated: result.updated },
            null,
            2,
          ),
        );
      } catch (err) {
        if ((err as ApiError).code) {
          return formatApiError(err as ApiError);
        }
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  // --- calendar_delete_event ---
  api.registerTool((ctx) => ({
    name: "calendar_delete_event",
    label: "Delete calendar event",
    description: "Delete a calendar event",
    parameters: CalendarDeleteEventSchema,
    async execute(_id: string, params: { calendarId?: string; eventId: string }) {
      const resolved = resolveCalendarEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No calendar service configured for this agent.");
      }

      // Defense in depth for delegated_human
      if (resolved.entry.mode === "delegated_human") {
        return errorResult(
          'Action "delete_event" is blocked in delegated_human mode. Ask the calendar owner to delete this event.',
        );
      }

      const policy = checkPolicy({
        config,
        serviceKind: "calendar",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "delete_event",
      });
      if (!policy.allowed) {
        return errorResult(policy.reason);
      }

      try {
        const { accessToken } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const client = new CalendarClient(accessToken);
        await client.deleteEvent({
          calendarId: params.calendarId ?? "primary",
          eventId: params.eventId,
          sendUpdates: resolveSendUpdates(resolved.entry.mode),
        });
        return textResult(JSON.stringify({ deleted: true, eventId: params.eventId }, null, 2));
      } catch (err) {
        if ((err as ApiError).code) {
          return formatApiError(err as ApiError);
        }
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  // --- calendar_check_availability ---
  api.registerTool((ctx) => ({
    name: "calendar_check_availability",
    label: "Check calendar availability",
    description: "Check free/busy status for one or more calendars",
    parameters: CalendarCheckAvailabilitySchema,
    async execute(
      _id: string,
      params: { timeMin: string; timeMax: string; timeZone?: string; calendars: string[] },
    ) {
      const resolved = resolveCalendarEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No calendar service configured for this agent.");
      }
      const policy = checkPolicy({
        config,
        serviceKind: "calendar",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "check_availability",
      });
      if (!policy.allowed) {
        return errorResult(policy.reason);
      }
      try {
        const { accessToken } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const client = new CalendarClient(accessToken);
        const result = await client.freeBusy({
          timeMin: params.timeMin,
          timeMax: params.timeMax,
          timeZone: params.timeZone,
          items: params.calendars.map((id) => ({ id })),
        });
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        if ((err as ApiError).code) {
          return formatApiError(err as ApiError);
        }
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));
}
