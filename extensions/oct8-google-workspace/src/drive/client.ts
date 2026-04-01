import { DRIVE_API_BASE } from "../constants.js";
import { ApiError, type ApiErrorCode } from "../types.js";

type FetchFn = typeof globalThis.fetch;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  parents?: string[];
  webViewLink?: string;
  webContentLink?: string;
  thumbnailLink?: string;
  iconLink?: string;
  owners?: Array<{ displayName: string; emailAddress: string }>;
  description?: string;
  starred?: boolean;
  trashed?: boolean;
  shared?: boolean;
};

export type FileListResponse = {
  kind: string;
  files: DriveFile[];
  nextPageToken?: string;
  incompleteSearch?: boolean;
};

// ---------------------------------------------------------------------------
// Google Workspace MIME types
// ---------------------------------------------------------------------------

const GOOGLE_WORKSPACE_MIME_TYPES = new Set([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
  "application/vnd.google-apps.drawing",
  "application/vnd.google-apps.script",
]);

/** Check if a file is a Google Workspace native format (not directly downloadable). */
export function isGoogleWorkspaceFile(mimeType: string): boolean {
  return GOOGLE_WORKSPACE_MIME_TYPES.has(mimeType);
}

// ---------------------------------------------------------------------------
// Default export MIME types per Google Workspace type
// ---------------------------------------------------------------------------

const DEFAULT_EXPORT_MIME: Record<string, string> = {
  "application/vnd.google-apps.document": "application/pdf",
  "application/vnd.google-apps.spreadsheet": "application/pdf",
  "application/vnd.google-apps.presentation": "application/pdf",
  "application/vnd.google-apps.drawing": "application/pdf",
  "application/vnd.google-apps.script": "application/vnd.google-apps.script+json",
};

export function getDefaultExportMime(mimeType: string): string {
  return DEFAULT_EXPORT_MIME[mimeType] ?? "application/pdf";
}

// ---------------------------------------------------------------------------
// Standard file fields to request
// ---------------------------------------------------------------------------

const FILE_FIELDS =
  "id,name,mimeType,size,createdTime,modifiedTime,parents,webViewLink,webContentLink,description,owners(displayName,emailAddress),starred,trashed,shared";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class DriveClient {
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

  /** Search files using Drive query syntax. */
  async searchFiles(params: {
    query: string;
    pageSize?: number;
    pageToken?: string;
    orderBy?: string;
  }): Promise<FileListResponse> {
    const qp = new URLSearchParams({
      q: params.query,
      fields: `kind,nextPageToken,incompleteSearch,files(${FILE_FIELDS})`,
      spaces: "drive",
    });
    if (params.pageSize) qp.set("pageSize", String(params.pageSize));
    if (params.pageToken) qp.set("pageToken", params.pageToken);
    if (params.orderBy) qp.set("orderBy", params.orderBy);
    qp.set("supportsAllDrives", "true");
    qp.set("includeItemsFromAllDrives", "true");
    return this.get<FileListResponse>(`${DRIVE_API_BASE}/files?${qp}`);
  }

  /** Get file metadata. */
  async getFile(fileId: string): Promise<DriveFile> {
    const qp = new URLSearchParams({
      fields: FILE_FIELDS,
      supportsAllDrives: "true",
    });
    return this.get<DriveFile>(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?${qp}`);
  }

  /**
   * Download file content. Returns the raw text content.
   * Only works for non-Google Workspace files. Use exportFile for Google Docs/Sheets/Slides.
   */
  async downloadFile(fileId: string): Promise<string> {
    const qp = new URLSearchParams({
      alt: "media",
      supportsAllDrives: "true",
    });
    const res = await this.fetchFn(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?${qp}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw await classifyError(res);
    return res.text();
  }

  /**
   * Export a Google Workspace file to a specified format.
   * Max export size: 10 MB.
   */
  async exportFile(fileId: string, mimeType: string): Promise<string> {
    const qp = new URLSearchParams({ mimeType });
    const res = await this.fetchFn(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/export?${qp}`,
      { headers: this.headers() },
    );
    if (!res.ok) throw await classifyError(res);
    return res.text();
  }

  /**
   * Upload a file using simple upload (metadata + content in one request).
   * For files under ~5MB. Larger files should use resumable upload (not implemented in v1).
   */
  async uploadFile(params: {
    name: string;
    content: string;
    mimeType: string;
    parentId?: string;
    description?: string;
  }): Promise<DriveFile> {
    const metadata: Record<string, unknown> = {
      name: params.name,
      mimeType: params.mimeType,
    };
    if (params.parentId) metadata["parents"] = [params.parentId];
    if (params.description) metadata["description"] = params.description;

    // Multipart upload: metadata JSON + file content
    const boundary = `oct8-drive-boundary-${Date.now()}`;
    const body = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${params.mimeType}`,
      "",
      params.content,
      `--${boundary}--`,
    ].join("\r\n");

    const qp = new URLSearchParams({
      uploadType: "multipart",
      fields: FILE_FIELDS,
      supportsAllDrives: "true",
    });

    const res = await this.fetchFn(`https://www.googleapis.com/upload/drive/v3/files?${qp}`, {
      method: "POST",
      headers: {
        ...this.headers(),
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!res.ok) throw await classifyError(res);
    return (await res.json()) as DriveFile;
  }

  // ---------------------------------------------------------------------------
  // HTTP helpers
  // ---------------------------------------------------------------------------

  private async get<T>(url: string): Promise<T> {
    const res = await this.fetchFn(url, { headers: this.headers() });
    if (!res.ok) throw await classifyError(res);
    return (await res.json()) as T;
  }
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

async function classifyError(res: Response): Promise<ApiError> {
  const status = res.status;
  const body = await res.text().catch(() => "");
  let errorReason: string | undefined;

  try {
    const json = JSON.parse(body) as { error?: { errors?: Array<{ reason?: string }> } };
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
    (errorReason === "rateLimitExceeded" || errorReason === "userRateLimitExceeded")
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
    `Drive API error (${status}): ${body.slice(0, 200) || res.statusText}`,
    code,
    status,
    retryAfter,
  );
}

function parseRetryAfter(res: Response): number | undefined {
  const header = res.headers.get("Retry-After");
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}
