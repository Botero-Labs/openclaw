import { randomUUID } from "node:crypto";

type MimeParams = {
  from?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  htmlBody?: string;
  inReplyTo?: string;
  references?: string;
};

/**
 * Build a base64url-encoded MIME message for the Gmail API.
 * Supports plain text, HTML, and multipart/alternative (both).
 */
export function buildMimeMessage(params: MimeParams): string {
  const headers: string[] = [];

  if (params.from) {
    headers.push(`From: ${sanitizeHeader(params.from)}`);
  }
  headers.push(`To: ${sanitizeHeader(params.to)}`);
  if (params.cc) {
    headers.push(`Cc: ${sanitizeHeader(params.cc)}`);
  }
  if (params.bcc) {
    headers.push(`Bcc: ${sanitizeHeader(params.bcc)}`);
  }
  headers.push(`Subject: ${encodeSubject(params.subject)}`);
  headers.push(`Date: ${new Date().toUTCString()}`);
  headers.push(`Message-ID: <${randomUUID()}@oct8.mail>`);
  headers.push("MIME-Version: 1.0");

  if (params.inReplyTo) {
    headers.push(`In-Reply-To: ${sanitizeHeader(params.inReplyTo)}`);
  }
  if (params.references) {
    headers.push(`References: ${sanitizeHeader(params.references)}`);
  }

  let messageBody: string;

  if (params.htmlBody) {
    // Multipart/alternative with both plain text and HTML
    const boundary = `oct8-boundary-${randomUUID().slice(0, 8)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

    messageBody = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      toBase64(params.body),
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      toBase64(params.htmlBody),
      `--${boundary}--`,
    ].join("\r\n");
  } else {
    // Plain text only
    headers.push("Content-Type: text/plain; charset=UTF-8");
    headers.push("Content-Transfer-Encoding: base64");
    messageBody = toBase64(params.body);
  }

  const raw = headers.join("\r\n") + "\r\n\r\n" + messageBody;
  return base64url(raw);
}

/** Strip CR/LF characters to prevent MIME header injection. */
function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

/**
 * Encode a subject line for RFC 2047 compatibility.
 * Uses encoded-word syntax for non-ASCII characters.
 */
function encodeSubject(subject: string): string {
  const sanitized = sanitizeHeader(subject);
  // Check if subject has non-ASCII characters
  if (/^[\x20-\x7E]*$/u.test(sanitized)) {
    return sanitized;
  }
  // RFC 2047 encoded-word: =?charset?encoding?encoded-text?=
  const encoded = Buffer.from(sanitized, "utf-8").toString("base64");
  return `=?UTF-8?B?${encoded}?=`;
}

function toBase64(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64");
}

function base64url(text: string): string {
  return Buffer.from(text, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
