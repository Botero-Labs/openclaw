---
name: oct8-google-workspace
description: Google Workspace tools for oct8 digital coworkers — Gmail, Calendar, Drive, Contacts, Sheets, and Docs with policy enforcement.
metadata:
  openclaw:
    emoji: "📬"
---

# oct8 Google Workspace

Native Google Workspace tools with policy enforcement for oct8 digital coworkers. Tools are registered conditionally — you only see tools for services configured for your account.

## Access Modes

Every service is configured with a mode that determines what you can do:

- **`delegated_human`**: You operate inside a human's account as an assistant. Read and draft operations are allowed, but destructive actions (sending email, deleting events, uploading files, writing to sheets) are **blocked**. The human reviews and acts.
- **`agent_owned`**: You have your own dedicated account with full autonomy.

---

## Gmail (8 tools)

| Tool                    | Description                                    |
| ----------------------- | ---------------------------------------------- |
| `gmail_search_threads`  | Search Gmail threads by query                  |
| `gmail_search_messages` | Search individual messages (ignores threading) |
| `gmail_get_thread`      | Fetch a full thread with all messages          |
| `gmail_get_message`     | Fetch a single message by ID                   |
| `gmail_create_draft`    | Create a new draft (standalone or reply)       |
| `gmail_update_draft`    | Replace an existing draft's content            |
| `gmail_send`            | Send a draft or compose-and-send directly      |
| `gmail_list_labels`     | List all Gmail labels                          |

**Mode restrictions**: `gmail_send` is blocked in `delegated_human` mode.

### Gmail Search Syntax

Use standard Gmail operators in the `query` parameter:

- `from:user@example.com` — from a specific sender
- `to:user@example.com` — to a specific recipient
- `subject:"meeting notes"` — subject contains phrase
- `is:unread` — unread messages only
- `newer_than:7d` — messages from the last 7 days
- `older_than:30d` — messages older than 30 days
- `has:attachment` — messages with attachments
- `label:important` — messages with a specific label
- `in:inbox` — messages in inbox
- Combine with spaces: `from:boss@company.com is:unread newer_than:1d`

### Gmail Workflows

**Inbox Triage (delegated_human)**:

1. `gmail_search_threads` with `is:unread newer_than:1d`
2. `gmail_get_thread` for each relevant thread
3. `gmail_create_draft` with a suggested reply
4. Notify the human that drafts are ready for review

**Direct Email (agent_owned)**:

1. `gmail_search_threads` to check for existing conversation
2. `gmail_send` with `to`, `subject`, `body` to compose and send
3. Or two-step: `gmail_create_draft` then `gmail_send` with `draftId`

**Reply Threading**: When replying, include `inReplyTo` (the Message-ID of the message you're replying to) and `references` (the References header from that message) to maintain proper threading.

---

## Calendar (7 tools)

| Tool                          | Description                                                     |
| ----------------------------- | --------------------------------------------------------------- |
| `calendar_list_calendars`     | List all calendars the account has access to                    |
| `calendar_list_events`        | List events in a time range (returns individual occurrences)    |
| `calendar_get_event`          | Fetch a single event by ID                                      |
| `calendar_create_event`       | Create a new calendar event                                     |
| `calendar_update_event`       | Update an existing event (fetches current, merges your changes) |
| `calendar_delete_event`       | Delete a calendar event                                         |
| `calendar_check_availability` | Check free/busy status for one or more calendars                |

**Mode restrictions**: `calendar_delete_event` is blocked in `delegated_human` mode. Create and update are allowed (calendar collaboration is expected).

**Notification behavior**: In `delegated_human` mode, attendee notifications are suppressed (`sendUpdates: none`). In `agent_owned` mode, all attendees are notified.

### Calendar Tips

- **calendarId**: Use `"primary"` for the default calendar (omit the parameter — it defaults to primary).
- **Time format**: Always use RFC3339 with timezone offset (e.g. `2026-04-01T09:00:00-04:00`). Include a `timeZone` parameter for consistent results.
- **All-day events**: Use `startDate` and `endDate` (yyyy-mm-dd format) instead of `startDateTime`/`endDateTime`. The end date is exclusive — a single-day event on April 1st needs `startDate: "2026-04-01"`, `endDate: "2026-04-02"`.
- **Do not mix** `startDateTime` with `startDate` — use one format consistently.
- **Recurring events**: Pass `recurrence` as an array of RRULE strings (e.g. `["RRULE:FREQ=WEEKLY;COUNT=10;BYDAY=MO"]`). Include `timeZone` for recurring events.
- **Colors**: Use `colorId` values 1-11 (run the tool without it first, then add color if needed).

### Calendar Workflows

**Check availability before scheduling**:

1. `calendar_check_availability` with the attendee calendar IDs and desired time range
2. Find a slot where all calendars show no busy blocks
3. `calendar_create_event` with attendees at the available time

**Reschedule an event**:

1. `calendar_get_event` to see current details
2. `calendar_update_event` with the new `startDateTime` and `endDateTime`

---

## Drive (5 tools)

| Tool                  | Description                                                     |
| --------------------- | --------------------------------------------------------------- |
| `drive_search_files`  | Search for files using Drive query syntax                       |
| `drive_get_file`      | Get file metadata (name, type, size, owner, links)              |
| `drive_download_file` | Download file content (non-Google files only)                   |
| `drive_upload_file`   | Upload a text file to Drive                                     |
| `drive_export_file`   | Export a Google Doc/Sheet/Slides to PDF, plain text, docx, etc. |

**Mode restrictions**: `drive_upload_file` is blocked in `delegated_human` mode.

### Drive Search Syntax

Use the `query` parameter with Drive query operators:

- `name contains 'report'` — file name contains word
- `fullText contains 'budget'` — content contains word
- `mimeType = 'application/pdf'` — specific file type
- `mimeType = 'application/vnd.google-apps.document'` — Google Docs
- `mimeType = 'application/vnd.google-apps.spreadsheet'` — Google Sheets
- `mimeType = 'application/vnd.google-apps.presentation'` — Google Slides
- `modifiedTime > '2026-03-01T00:00:00'` — modified after date
- `trashed = false` — exclude trashed files
- `'folder-id' in parents` — files in a specific folder
- `sharedWithMe` — files shared with the account
- Combine with `and`/`or`: `name contains 'Q1' and mimeType = 'application/pdf'`

### Google Workspace Files vs Regular Files

- **Regular files** (PDF, images, text): Use `drive_download_file` to get the content.
- **Google Docs/Sheets/Slides**: Cannot be downloaded directly. Use `drive_export_file` to convert them to a standard format first. Recommended export formats:
  - Google Docs: `text/plain` (readable text), `text/markdown`, `application/pdf`
  - Google Sheets: `text/csv`, `application/pdf`
  - Google Slides: `text/plain`, `application/pdf`

If you try `drive_download_file` on a Google Workspace file, the tool will tell you to use `drive_export_file` instead.

---

## Contacts (5 tools)

| Tool              | Description                                                           |
| ----------------- | --------------------------------------------------------------------- |
| `contacts_list`   | List all contacts with pagination and sorting                         |
| `contacts_search` | Search contacts by name, email, phone, or organization                |
| `contacts_get`    | Get a single contact by resource name                                 |
| `contacts_create` | Create a new contact                                                  |
| `contacts_update` | Update an existing contact (fetches current for etag, merges changes) |

**Mode restrictions**: `contacts_create` and `contacts_update` are blocked in `delegated_human` mode.

### Contacts Tips

- **Resource names** use the format `people/c1234567890`. You get these from `contacts_list` or `contacts_search`.
- **Search is prefix-based**: Searching for "Joh" matches "John" and "Johanna". Search matches against names, emails, phones, and organizations.
- **Search max**: Results are capped at 30 per query.
- **Sort options**: `FIRST_NAME_ASCENDING`, `LAST_NAME_ASCENDING`, `LAST_MODIFIED_ASCENDING`, `LAST_MODIFIED_DESCENDING`.
- **Update uses etag**: The tool fetches the current contact first to get the etag (required by Google to prevent conflicts), then merges your changes.

---

## Sheets (5 tools)

| Tool                  | Description                                        |
| --------------------- | -------------------------------------------------- |
| `sheets_get_metadata` | Get spreadsheet title, sheet names, and properties |
| `sheets_read_range`   | Read values from a range (A1 notation)             |
| `sheets_write_range`  | Write values to a range (replaces existing values) |
| `sheets_append_rows`  | Append rows after existing data in a range         |
| `sheets_clear_range`  | Clear all values in a range                        |

**Mode restrictions**: `sheets_write_range`, `sheets_append_rows`, and `sheets_clear_range` are blocked in `delegated_human` mode.

### A1 Notation

Ranges use `SheetName!CellRange` format:

- `Sheet1!A1:D10` — columns A-D, rows 1-10
- `Sheet1!A:A` — entire column A
- `Sheet1!1:5` — rows 1-5
- `Sheet1!A1` — single cell
- If the sheet name has spaces, quote it: `'My Sheet'!A1:B5`

### Sheets Tips

- **Get metadata first**: Use `sheets_get_metadata` to see sheet names and dimensions before reading/writing.
- **Values format**: `sheets_write_range` and `sheets_append_rows` take a 2D array: `[["Name", "Email"], ["John", "john@example.com"]]`.
- **Input handling**: Values are interpreted as user input (`USER_ENTERED`) — formulas like `=SUM(A1:A10)` will be evaluated.
- **Append behavior**: `sheets_append_rows` finds the last row of data in the specified range and adds rows below it.

---

## Docs (2 tools)

| Tool                   | Description                                                                    |
| ---------------------- | ------------------------------------------------------------------------------ |
| `docs_read_document`   | Read a Google Doc and extract its text content                                 |
| `docs_export_document` | Export a Google Doc to plain text, markdown, PDF, docx, HTML, or other formats |

**Mode restrictions**: None — both tools are read-only in all modes.

### Docs Tips

- **`docs_read_document`** extracts plain text from the document structure. Good for quick content reads.
- **`docs_export_document`** uses the Drive export API for formatted output. Default format is `text/plain`. Use `text/markdown` for structured text with headings preserved.
- Large documents are truncated at 50,000 characters with a notice.

---

## Error Reference

These errors apply across all services:

| Error                                      | Meaning                                                | Action                                                                             |
| ------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `Error: ... blocked in delegated_human`    | Action is not allowed in your access mode              | Use read/draft operations instead, or ask the account owner to perform this action |
| `Error: ... not authorized`                | Your agent ID is not in the allowedAgents list         | Contact your administrator to add your agent to the service config                 |
| `Error: ... not configured for this agent` | No service entry matches your agent                    | Check that the plugin config has an entry for this service kind                    |
| `Error: ... No OAuth token found`          | No stored credentials for this account                 | OAuth authorization needed — notify your manager                                   |
| `Error: ... expired_token`                 | OAuth access token expired and refresh failed          | Re-authorization needed — notify your manager                                      |
| `Error: ... rate_limited`                  | Google API rate limit hit                              | Wait the indicated time, then retry                                                |
| `Error: ... not_found`                     | Resource (message, event, file, contact) doesn't exist | Verify the ID is correct                                                           |
| `Error: ... insufficient_scope`            | Token lacks permissions for this operation             | Re-authorization with correct scopes needed                                        |
| `Error: ... forbidden`                     | Account doesn't have access to this resource           | Check sharing permissions                                                          |
| `Error: ... invalid_request`               | Malformed request (bad parameters, missing fields)     | Check the parameter format and try again                                           |
