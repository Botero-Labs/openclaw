import { PEOPLE_API_BASE } from "../constants.js";
import { ApiError, type ApiErrorCode } from "../types.js";

type FetchFn = typeof globalThis.fetch;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export type PersonName = {
  displayName?: string;
  familyName?: string;
  givenName?: string;
  middleName?: string;
};

export type PersonEmail = {
  value: string;
  type?: string;
  formattedType?: string;
};

export type PersonPhone = {
  value: string;
  type?: string;
  formattedType?: string;
};

export type PersonOrganization = {
  name?: string;
  title?: string;
  department?: string;
};

export type PersonAddress = {
  formattedValue?: string;
  type?: string;
  streetAddress?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
};

export type Person = {
  resourceName: string;
  etag?: string;
  metadata?: {
    sources?: Array<{ type: string; id: string; etag?: string }>;
  };
  names?: PersonName[];
  emailAddresses?: PersonEmail[];
  phoneNumbers?: PersonPhone[];
  organizations?: PersonOrganization[];
  addresses?: PersonAddress[];
  biographies?: Array<{ value: string }>;
  urls?: Array<{ value: string; type?: string }>;
  birthdays?: Array<{ date?: { year?: number; month?: number; day?: number } }>;
};

export type ListConnectionsResponse = {
  connections?: Person[];
  nextPageToken?: string;
  totalItems?: number;
};

export type SearchResponse = {
  results?: Array<{ person: Person }>;
};

// ---------------------------------------------------------------------------
// Standard person fields to request
// ---------------------------------------------------------------------------

const PERSON_FIELDS =
  "names,emailAddresses,phoneNumbers,organizations,addresses,biographies,urls,metadata";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class ContactsClient {
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

  /** List all contacts with pagination. */
  async listContacts(params?: {
    pageSize?: number;
    pageToken?: string;
    sortOrder?:
      | "LAST_MODIFIED_ASCENDING"
      | "LAST_MODIFIED_DESCENDING"
      | "FIRST_NAME_ASCENDING"
      | "LAST_NAME_ASCENDING";
  }): Promise<ListConnectionsResponse> {
    const qp = new URLSearchParams({
      personFields: PERSON_FIELDS,
    });
    if (params?.pageSize) {
      qp.set("pageSize", String(params.pageSize));
    }
    if (params?.pageToken) {
      qp.set("pageToken", params.pageToken);
    }
    if (params?.sortOrder) {
      qp.set("sortOrder", params.sortOrder);
    }
    return this.get<ListConnectionsResponse>(`${PEOPLE_API_BASE}/people/me/connections?${qp}`);
  }

  /** Search contacts by name, email, phone, or organization. Prefix matching. */
  async searchContacts(query: string, pageSize?: number): Promise<SearchResponse> {
    const qp = new URLSearchParams({
      query,
      readMask: PERSON_FIELDS,
    });
    if (pageSize) {
      qp.set("pageSize", String(Math.min(pageSize, 30)));
    }
    return this.get<SearchResponse>(`${PEOPLE_API_BASE}/people:searchContacts?${qp}`);
  }

  /** Get a single contact by resourceName. */
  async getContact(resourceName: string): Promise<Person> {
    validateResourceName(resourceName);
    const qp = new URLSearchParams({
      personFields: PERSON_FIELDS,
    });
    return this.get<Person>(`${PEOPLE_API_BASE}/${resourceName}?${qp}`);
  }

  /** Create a new contact. */
  async createContact(person: Partial<Person>): Promise<Person> {
    const qp = new URLSearchParams({
      personFields: PERSON_FIELDS,
    });
    return this.post<Person>(`${PEOPLE_API_BASE}/people:createContact?${qp}`, person);
  }

  /**
   * Update an existing contact. Requires etag from the contact's metadata.
   * Uses PATCH with updatePersonFields.
   */
  async updateContact(params: {
    resourceName: string;
    person: Partial<Person>;
    updatePersonFields: string;
  }): Promise<Person> {
    validateResourceName(params.resourceName);
    const qp = new URLSearchParams({
      updatePersonFields: params.updatePersonFields,
      personFields: PERSON_FIELDS,
    });
    const res = await this.fetchFn(
      `${PEOPLE_API_BASE}/${params.resourceName}:updateContact?${qp}`,
      {
        method: "PATCH",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify(params.person),
      },
    );
    if (!res.ok) {
      throw await classifyError(res);
    }
    return (await res.json()) as Person;
  }

  // ---------------------------------------------------------------------------
  // HTTP helpers
  // ---------------------------------------------------------------------------

  private async get<T>(url: string): Promise<T> {
    const res = await this.fetchFn(url, { headers: this.headers() });
    if (!res.ok) {
      throw await classifyError(res);
    }
    return (await res.json()) as T;
  }

  private async post<T>(url: string, body: unknown): Promise<T> {
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw await classifyError(res);
    }
    return (await res.json()) as T;
  }
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const RESOURCE_NAME_RE = /^people\/[a-zA-Z0-9]+$/;

function validateResourceName(resourceName: string): void {
  if (!RESOURCE_NAME_RE.test(resourceName)) {
    throw new ApiError(
      `Invalid resource name "${resourceName}". Expected format: people/cNNNNNNN`,
      "invalid_request",
      400,
    );
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
    `People API error (${status}): ${body.slice(0, 200) || res.statusText}`,
    code,
    status,
    retryAfter,
  );
}

function parseRetryAfter(res: Response): number | undefined {
  const header = res.headers.get("Retry-After");
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}
