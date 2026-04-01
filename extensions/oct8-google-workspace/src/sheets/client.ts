import { SHEETS_API_BASE } from "../constants.js";
import { ApiError, type ApiErrorCode } from "../types.js";

type FetchFn = typeof globalThis.fetch;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export type SpreadsheetMetadata = {
  spreadsheetId: string;
  properties: {
    title: string;
    locale?: string;
    autoRecalc?: string;
    timeZone?: string;
    defaultFormat?: Record<string, unknown>;
  };
  sheets: Array<{
    properties: {
      sheetId: number;
      title: string;
      index: number;
      sheetType: string;
      gridProperties?: { rowCount: number; columnCount: number };
    };
  }>;
  spreadsheetUrl: string;
};

export type ValueRange = {
  range: string;
  majorDimension: string;
  values: unknown[][];
};

export type UpdateValuesResponse = {
  spreadsheetId: string;
  updatedRange: string;
  updatedRows: number;
  updatedColumns: number;
  updatedCells: number;
};

export type AppendValuesResponse = {
  spreadsheetId: string;
  tableRange: string;
  updates: UpdateValuesResponse;
};

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class SheetsClient {
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

  /** Get spreadsheet metadata (title, sheets, properties). */
  async getMetadata(spreadsheetId: string): Promise<SpreadsheetMetadata> {
    const qp = new URLSearchParams({
      fields: "spreadsheetId,properties,sheets.properties,spreadsheetUrl",
    });
    return this.get<SpreadsheetMetadata>(
      `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?${qp}`,
    );
  }

  /** Read values from a range. */
  async readRange(spreadsheetId: string, range: string): Promise<ValueRange> {
    const qp = new URLSearchParams({ valueRenderOption: "FORMATTED_VALUE" });
    return this.get<ValueRange>(
      `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?${qp}`,
    );
  }

  /** Write values to a range (full replacement of the range). */
  async writeRange(
    spreadsheetId: string,
    range: string,
    values: unknown[][],
  ): Promise<UpdateValuesResponse> {
    const qp = new URLSearchParams({ valueInputOption: "USER_ENTERED" });
    const res = await this.fetchFn(
      `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?${qp}`,
      {
        method: "PUT",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ range, majorDimension: "ROWS", values }),
      },
    );
    if (!res.ok) throw await classifyError(res);
    return (await res.json()) as UpdateValuesResponse;
  }

  /** Append rows after existing data in a range. */
  async appendRows(
    spreadsheetId: string,
    range: string,
    values: unknown[][],
  ): Promise<AppendValuesResponse> {
    const qp = new URLSearchParams({
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
    });
    const res = await this.fetchFn(
      `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?${qp}`,
      {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ range, majorDimension: "ROWS", values }),
      },
    );
    if (!res.ok) throw await classifyError(res);
    return (await res.json()) as AppendValuesResponse;
  }

  /** Clear all values in a range. */
  async clearRange(
    spreadsheetId: string,
    range: string,
  ): Promise<{ spreadsheetId: string; clearedRange: string }> {
    const res = await this.fetchFn(
      `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`,
      {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    if (!res.ok) throw await classifyError(res);
    return (await res.json()) as { spreadsheetId: string; clearedRange: string };
  }

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

  let code: ApiErrorCode;
  if (status === 401) code = "expired_token";
  else if (status === 403) code = "forbidden";
  else if (status === 404) code = "not_found";
  else if (status === 429) code = "rate_limited";
  else if (status === 400) code = "invalid_request";
  else if (status >= 500) code = "server_error";
  else code = "unknown";

  return new ApiError(
    `Sheets API error (${status}): ${body.slice(0, 200) || res.statusText}`,
    code,
    status,
  );
}
