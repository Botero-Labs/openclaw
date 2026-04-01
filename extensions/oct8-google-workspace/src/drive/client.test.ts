import { describe, expect, it } from "vitest";
import { DRIVE_API_BASE } from "../constants.js";
import { ApiError } from "../types.js";
import { DriveClient, getDefaultExportMime, isGoogleWorkspaceFile } from "./client.js";

type Call = { url: string; init: RequestInit };

function createMockClient(
  responseBody: unknown,
  status = 200,
): { client: DriveClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { client: new DriveClient("test-token", fetchFn), calls };
}

function createTextClient(text: string, status = 200): { client: DriveClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(text, { status });
  }) as typeof globalThis.fetch;
  return { client: new DriveClient("test-token", fetchFn), calls };
}

function createErrorClient(status: number, errorBody: unknown): DriveClient {
  const fetchFn = (async () =>
    new Response(JSON.stringify(errorBody), { status })) as typeof globalThis.fetch;
  return new DriveClient("test-token", fetchFn);
}

describe("DriveClient", () => {
  describe("searchFiles", () => {
    it("sends query parameter", async () => {
      const { client, calls } = createMockClient({ kind: "drive#fileList", files: [] });
      await client.searchFiles({ query: "name contains 'report'" });
      expect(calls[0]!.url).toContain("q=name+contains");
      expect(calls[0]!.url).toContain(`${DRIVE_API_BASE}/files?`);
    });

    it("includes pageSize and orderBy", async () => {
      const { client, calls } = createMockClient({ files: [] });
      await client.searchFiles({
        query: "trashed=false",
        pageSize: 20,
        orderBy: "modifiedTime desc",
      });
      expect(calls[0]!.url).toContain("pageSize=20");
      expect(calls[0]!.url).toContain("orderBy=modifiedTime+desc");
    });

    it("includes Authorization header", async () => {
      const { client, calls } = createMockClient({ files: [] });
      await client.searchFiles({ query: "test" });
      expect((calls[0]!.init.headers as Record<string, string>)["Authorization"]).toBe(
        "Bearer test-token",
      );
    });
  });

  describe("getFile", () => {
    it("fetches file metadata", async () => {
      const file = { id: "file-1", name: "report.pdf", mimeType: "application/pdf" };
      const { client, calls } = createMockClient(file);
      const result = await client.getFile("file-1");
      expect(result.id).toBe("file-1");
      expect(calls[0]!.url).toContain("/files/file-1");
    });
  });

  describe("downloadFile", () => {
    it("downloads file content with alt=media", async () => {
      const { client, calls } = createTextClient("file content here");
      const content = await client.downloadFile("file-1");
      expect(content).toBe("file content here");
      expect(calls[0]!.url).toContain("alt=media");
    });
  });

  describe("exportFile", () => {
    it("exports with specified MIME type", async () => {
      const { client, calls } = createTextClient("exported content");
      const content = await client.exportFile("doc-1", "text/plain");
      expect(content).toBe("exported content");
      expect(calls[0]!.url).toContain("/export?");
      expect(calls[0]!.url).toContain("mimeType=text%2Fplain");
    });
  });

  describe("uploadFile", () => {
    it("sends multipart upload", async () => {
      const { client, calls } = createMockClient({ id: "new-file", name: "test.txt" });
      await client.uploadFile({
        name: "test.txt",
        content: "hello world",
        mimeType: "text/plain",
        parentId: "folder-1",
      });
      expect(calls[0]!.init.method).toBe("POST");
      expect(calls[0]!.url).toContain("upload/drive/v3/files");
      expect(calls[0]!.url).toContain("uploadType=multipart");
      const contentType = (calls[0]!.init.headers as Record<string, string>)["Content-Type"];
      expect(contentType).toContain("multipart/related");
    });
  });

  describe("error classification", () => {
    it("classifies 401 as expired_token", async () => {
      const client = createErrorClient(401, {});
      const err = await client.searchFiles({ query: "test" }).catch((e) => e);
      expect((err as ApiError).code).toBe("expired_token");
    });

    it("classifies 404 as not_found", async () => {
      const client = createErrorClient(404, {});
      const err = await client.getFile("nonexistent").catch((e) => e);
      expect((err as ApiError).code).toBe("not_found");
    });

    it("classifies 403 + rateLimitExceeded as rate_limited", async () => {
      const client = createErrorClient(403, {
        error: { errors: [{ reason: "rateLimitExceeded" }] },
      });
      const err = await client.searchFiles({ query: "test" }).catch((e) => e);
      expect((err as ApiError).code).toBe("rate_limited");
    });
  });
});

describe("isGoogleWorkspaceFile", () => {
  it("returns true for Google Docs", () => {
    expect(isGoogleWorkspaceFile("application/vnd.google-apps.document")).toBe(true);
  });

  it("returns true for Google Sheets", () => {
    expect(isGoogleWorkspaceFile("application/vnd.google-apps.spreadsheet")).toBe(true);
  });

  it("returns false for regular files", () => {
    expect(isGoogleWorkspaceFile("application/pdf")).toBe(false);
    expect(isGoogleWorkspaceFile("text/plain")).toBe(false);
  });
});

describe("getDefaultExportMime", () => {
  it("returns PDF for Google Docs", () => {
    expect(getDefaultExportMime("application/vnd.google-apps.document")).toBe("application/pdf");
  });

  it("returns PDF for unknown types", () => {
    expect(getDefaultExportMime("application/unknown")).toBe("application/pdf");
  });
});
