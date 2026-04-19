import type { ServiceKind, ServiceMode } from "./types.js";

// ---------------------------------------------------------------------------
// Google OAuth
// ---------------------------------------------------------------------------

export const GOOGLE_OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";

// ---------------------------------------------------------------------------
// Google REST API base URLs
// ---------------------------------------------------------------------------

export const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
export const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
export const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
export const PEOPLE_API_BASE = "https://people.googleapis.com/v1";
export const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
export const DOCS_API_BASE = "https://docs.googleapis.com/v1/documents";

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

/** Refresh tokens this many seconds before actual expiry. */
export const TOKEN_REFRESH_SKEW_SECONDS = 300;

// ---------------------------------------------------------------------------
// OAuth scopes per (service, mode)
// ---------------------------------------------------------------------------

const SCOPE_PREFIX = "https://www.googleapis.com/auth/";

function scopes(...names: string[]): string[] {
  return names.map((n) => `${SCOPE_PREFIX}${n}`);
}

/** Minimal OAuth scopes required for each (ServiceKind, ServiceMode) pair. */
export const SCOPES_BY_SERVICE_AND_MODE: Record<ServiceKind, Record<ServiceMode, string[]>> = {
  mail: {
    delegated_human: scopes("gmail.readonly", "gmail.compose"),
    agent_owned: scopes("gmail.modify"),
  },
  calendar: {
    delegated_human: scopes("calendar.events.readonly"),
    agent_owned: scopes("calendar.events"),
  },
  drive: {
    delegated_human: scopes("drive.readonly"),
    agent_owned: scopes("drive.file"),
  },
  contacts: {
    delegated_human: scopes("contacts.readonly"),
    agent_owned: scopes("contacts"),
  },
  sheets: {
    delegated_human: scopes("spreadsheets.readonly"),
    agent_owned: scopes("spreadsheets"),
  },
  docs: {
    delegated_human: scopes("documents.readonly"),
    agent_owned: scopes("documents.readonly"),
  },
};

// ---------------------------------------------------------------------------
// Valid actions per service
// ---------------------------------------------------------------------------

export const ACTIONS_BY_SERVICE: Record<ServiceKind, readonly string[]> = {
  mail: [
    "search_threads",
    "search_messages",
    "get_thread",
    "get_message",
    "create_draft",
    "update_draft",
    "send",
    "list_labels",
  ],
  calendar: [
    "list_calendars",
    "list_events",
    "get_event",
    "create_event",
    "update_event",
    "delete_event",
    "check_availability",
  ],
  drive: ["search_files", "get_file", "download_file", "upload_file", "export_file"],
  contacts: ["list_contacts", "search_contacts", "get_contact", "create_contact", "update_contact"],
  sheets: ["get_metadata", "read_range", "write_range", "append_rows", "clear_range"],
  docs: ["read_document", "export_document"],
};

/** Actions blocked in `delegated_human` mode for each service. */
export const DESTRUCTIVE_ACTIONS_BY_SERVICE: Record<ServiceKind, readonly string[]> = {
  mail: ["send"],
  calendar: ["delete_event"],
  drive: ["upload_file"],
  contacts: ["create_contact", "update_contact"],
  sheets: ["write_range", "append_rows", "clear_range"],
  docs: [],
};

// ---------------------------------------------------------------------------
// Recognized service kinds (for validation)
// ---------------------------------------------------------------------------

export const SERVICE_KINDS: readonly ServiceKind[] = [
  "mail",
  "calendar",
  "drive",
  "contacts",
  "sheets",
  "docs",
];

export const SERVICE_MODES: readonly ServiceMode[] = ["delegated_human", "agent_owned"];
