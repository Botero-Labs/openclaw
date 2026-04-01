import { DOCS_API_BASE, DRIVE_API_BASE } from "../constants.js";
import { ApiError, type ApiErrorCode } from "../types.js";

type FetchFn = typeof globalThis.fetch;

export type DocumentContent = {
  documentId: string;
  title: string;
  body?: {
    content?: Array<{
      paragraph?: {
        elements?: Array<{
          textRun?: { content: string };
        }>;
      };
      table?: Record<string, unknown>;
      sectionBreak?: Record<string, unknown>;
    }>;
  };
  revisionId?: string;
};

export class DocsClient {
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

  /** Read a Google Doc and extract its text content. */
  async readDocument(documentId: string): Promise<DocumentContent> {
    const res = await this.fetchFn(`${DOCS_API_BASE}/${encodeURIComponent(documentId)}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw await classifyError(res);
    return (await res.json()) as DocumentContent;
  }

  /** Export a Google Doc via Drive export API. */
  async exportDocument(documentId: string, mimeType: string): Promise<string> {
    const qp = new URLSearchParams({ mimeType });
    const res = await this.fetchFn(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(documentId)}/export?${qp}`,
      { headers: this.headers() },
    );
    if (!res.ok) throw await classifyError(res);
    return res.text();
  }
}

/** Extract plain text from a Google Docs document structure. */
export function extractDocumentText(doc: DocumentContent): string {
  const parts: string[] = [];
  for (const element of doc.body?.content ?? []) {
    if (element.paragraph?.elements) {
      for (const el of element.paragraph.elements) {
        if (el.textRun?.content) parts.push(el.textRun.content);
      }
    }
  }
  return parts.join("");
}

async function classifyError(res: Response): Promise<ApiError> {
  const status = res.status;
  const body = await res.text().catch(() => "");

  let code: ApiErrorCode;
  if (status === 401) code = "expired_token";
  else if (status === 403) code = "forbidden";
  else if (status === 404) code = "not_found";
  else if (status === 429) code = "rate_limited";
  else if (status === 400) code = "invalid_request";
  else if (status >= 500) code = "server_error";
  else code = "unknown";

  return new ApiError(
    `Docs API error (${status}): ${body.slice(0, 200) || res.statusText}`,
    code,
    status,
  );
}
