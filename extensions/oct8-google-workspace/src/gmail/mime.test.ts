import { describe, expect, it } from "vitest";
import { buildMimeMessage } from "./mime.js";

function decodeMime(base64url: string): string {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

describe("buildMimeMessage", () => {
  it("produces valid plain text MIME message", () => {
    const raw = buildMimeMessage({
      to: "will@diagon.com",
      subject: "Hello",
      body: "Hi Will, how are you?",
    });
    const decoded = decodeMime(raw);

    expect(decoded).toContain("To: will@diagon.com");
    expect(decoded).toContain("Subject: Hello");
    expect(decoded).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(decoded).toContain("MIME-Version: 1.0");
  });

  it("includes From header when provided", () => {
    const raw = buildMimeMessage({
      from: "albus@diagon.com",
      to: "will@diagon.com",
      subject: "Test",
      body: "test",
    });
    const decoded = decodeMime(raw);
    expect(decoded).toContain("From: albus@diagon.com");
  });

  it("includes Cc and Bcc headers", () => {
    const raw = buildMimeMessage({
      to: "a@b.com",
      cc: "c@d.com",
      bcc: "e@f.com",
      subject: "Test",
      body: "test",
    });
    const decoded = decodeMime(raw);
    expect(decoded).toContain("Cc: c@d.com");
    expect(decoded).toContain("Bcc: e@f.com");
  });

  it("produces multipart/alternative when htmlBody is provided", () => {
    const raw = buildMimeMessage({
      to: "a@b.com",
      subject: "Rich email",
      body: "Plain text version",
      htmlBody: "<p>HTML version</p>",
    });
    const decoded = decodeMime(raw);

    expect(decoded).toContain("Content-Type: multipart/alternative; boundary=");
    expect(decoded).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(decoded).toContain("Content-Type: text/html; charset=UTF-8");
  });

  it("sets In-Reply-To and References headers for replies", () => {
    const raw = buildMimeMessage({
      to: "a@b.com",
      subject: "Re: Original subject",
      body: "Reply body",
      inReplyTo: "<original-msg-id@gmail.com>",
      references: "<original-msg-id@gmail.com> <another@gmail.com>",
    });
    const decoded = decodeMime(raw);

    expect(decoded).toContain("In-Reply-To: <original-msg-id@gmail.com>");
    expect(decoded).toContain("References: <original-msg-id@gmail.com> <another@gmail.com>");
  });

  it("encodes UTF-8 subject with RFC 2047", () => {
    const raw = buildMimeMessage({
      to: "a@b.com",
      subject: "日本語テスト",
      body: "test",
    });
    const decoded = decodeMime(raw);

    expect(decoded).toContain("Subject: =?UTF-8?B?");
    expect(decoded).not.toContain("Subject: 日本語テスト");
  });

  it("does not encode ASCII-only subjects", () => {
    const raw = buildMimeMessage({
      to: "a@b.com",
      subject: "Plain ASCII subject",
      body: "test",
    });
    const decoded = decodeMime(raw);
    expect(decoded).toContain("Subject: Plain ASCII subject");
  });

  it("generates Message-ID header", () => {
    const raw = buildMimeMessage({
      to: "a@b.com",
      subject: "Test",
      body: "test",
    });
    const decoded = decodeMime(raw);
    expect(decoded).toMatch(/Message-ID: <[a-f0-9-]+@oct8\.mail>/);
  });

  it("omits optional headers when not provided", () => {
    const raw = buildMimeMessage({
      to: "a@b.com",
      subject: "Test",
      body: "test",
    });
    const decoded = decodeMime(raw);

    expect(decoded).not.toContain("From:");
    expect(decoded).not.toContain("Cc:");
    expect(decoded).not.toContain("Bcc:");
    expect(decoded).not.toContain("In-Reply-To:");
    expect(decoded).not.toContain("References:");
  });

  it("produces valid base64url (no +, /, or =)", () => {
    const raw = buildMimeMessage({
      to: "a@b.com",
      subject: "Test with special chars: +/=",
      body: "Body with special chars: +/= and more",
    });
    expect(raw).not.toMatch(/[+/=]/);
  });
});
