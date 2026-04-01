import { Type } from "@sinclair/typebox";

function stringEnum<T extends readonly string[]>(values: T, description: string) {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: [...values],
    description,
  });
}

export const GmailSearchThreadsSchema = Type.Object(
  {
    query: Type.String({ description: "Gmail search query (e.g. 'is:unread newer_than:7d')" }),
    maxResults: Type.Optional(
      Type.Number({ description: "Max threads to return (1-500)", minimum: 1, maximum: 500 }),
    ),
    pageToken: Type.Optional(Type.String({ description: "Page token for pagination" })),
  },
  { additionalProperties: false },
);

export const GmailSearchMessagesSchema = Type.Object(
  {
    query: Type.String({ description: "Gmail search query for individual messages" }),
    maxResults: Type.Optional(
      Type.Number({ description: "Max messages to return (1-500)", minimum: 1, maximum: 500 }),
    ),
    pageToken: Type.Optional(Type.String({ description: "Page token for pagination" })),
  },
  { additionalProperties: false },
);

export const GmailGetThreadSchema = Type.Object(
  {
    threadId: Type.String({ description: "Gmail thread ID" }),
    format: Type.Optional(
      stringEnum(["full", "metadata", "minimal"] as const, "Response format (default: full)"),
    ),
  },
  { additionalProperties: false },
);

export const GmailGetMessageSchema = Type.Object(
  {
    messageId: Type.String({ description: "Gmail message ID" }),
    format: Type.Optional(
      stringEnum(
        ["full", "metadata", "minimal", "raw"] as const,
        "Response format (default: full)",
      ),
    ),
  },
  { additionalProperties: false },
);

export const GmailCreateDraftSchema = Type.Object(
  {
    to: Type.String({ description: "Recipient email address" }),
    subject: Type.String({ description: "Email subject line" }),
    body: Type.String({ description: "Plain text email body" }),
    htmlBody: Type.Optional(
      Type.String({ description: "HTML email body (creates multipart message)" }),
    ),
    cc: Type.Optional(Type.String({ description: "CC recipients (comma-separated)" })),
    bcc: Type.Optional(Type.String({ description: "BCC recipients (comma-separated)" })),
    inReplyTo: Type.Optional(
      Type.String({ description: "Message-ID of the message being replied to" }),
    ),
    references: Type.Optional(
      Type.String({ description: "References header for reply threading" }),
    ),
  },
  { additionalProperties: false },
);

export const GmailUpdateDraftSchema = Type.Object(
  {
    draftId: Type.String({ description: "ID of the draft to update" }),
    to: Type.String({ description: "Recipient email address" }),
    subject: Type.String({ description: "Email subject line" }),
    body: Type.String({ description: "Plain text email body" }),
    htmlBody: Type.Optional(Type.String({ description: "HTML email body" })),
    cc: Type.Optional(Type.String({ description: "CC recipients" })),
    bcc: Type.Optional(Type.String({ description: "BCC recipients" })),
  },
  { additionalProperties: false },
);

export const GmailSendSchema = Type.Object(
  {
    draftId: Type.Optional(
      Type.String({
        description: "Send an existing draft by ID (mutually exclusive with to/subject/body)",
      }),
    ),
    to: Type.Optional(Type.String({ description: "Recipient email (for compose-and-send)" })),
    subject: Type.Optional(Type.String({ description: "Email subject (for compose-and-send)" })),
    body: Type.Optional(Type.String({ description: "Plain text body (for compose-and-send)" })),
    htmlBody: Type.Optional(Type.String({ description: "HTML body (for compose-and-send)" })),
    cc: Type.Optional(Type.String({ description: "CC recipients" })),
    bcc: Type.Optional(Type.String({ description: "BCC recipients" })),
    inReplyTo: Type.Optional(Type.String({ description: "Message-ID for reply threading" })),
    references: Type.Optional(
      Type.String({ description: "References header for reply threading" }),
    ),
  },
  { additionalProperties: false },
);

export const GmailListLabelsSchema = Type.Object({}, { additionalProperties: false });
