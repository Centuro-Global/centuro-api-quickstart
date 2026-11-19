/**
 * A small client for the Centuro Global public API.
 *
 * It has no dependencies, so you can copy this one file into your own project.
 * It handles:
 *  - swapping your API key (client ID + secret) for an access token, and renewing it before it expires
 *  - paging through lists with `nextCursor`
 *  - turning error responses into a `CenturoApiError` you can branch on
 *  - waiting and retrying once when you hit the rate limit
 */

// ---------------------------------------------------------------------------
// Types: the shapes the API returns
// ---------------------------------------------------------------------------

/** Every list endpoint returns this envelope. Single items are returned bare. */
export interface ListResponse<T> {
  data: T[];
  pagination: { nextCursor?: string; hasMore: boolean };
}

export interface Me {
  client: { id: string };
  scopes: string[];
  corporate?: { name: string };
}

export interface Case {
  /** Opaque ID, e.g. `case_8f3k2m…`. Use it with `cases.get`. */
  id: string;
  /** The case number you and Centuro already quote. */
  reference: string;
  caseType: string;
  country: string | null;
  applicant: {
    name: string | null;
    firstName: string | null;
    lastName: string | null;
    title: string | null;
    companyName: string | null;
  };
  /** The client-facing status, e.g. `waiting_on_client`. New values may be added: handle ones you don't know. */
  standardisedStatus: string | null;
  /** Centuro's own stage, e.g. `awaiting_government_response`. */
  stage: string;
  startDate: string | null;
  targetStartDate: string | null;
  visaIssueDate: string | null;
  visaExpiryDate: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CaseType {
  /** Stable code: `<category>.<type>`. */
  id: string;
  name: string;
  description?: string;
  category: { id: string; name: string };
}

/** A date range filter. Dates are ISO 8601, e.g. `2026-01-01` or `2026-01-01T09:00:00Z`. */
export interface Range {
  gte?: string;
  lt?: string;
}

export interface ListCasesParams {
  /** `false` (default) for live cases, `true` for archived ones. */
  archived?: boolean;
  /** ISO country code. */
  country?: string;
  standardisedStatus?: string;
  createdAt?: Range;
  updatedAt?: Range;
  /** `-createdAt` (default, newest first) or `updatedAt` (oldest change first: best for syncing). */
  sort?: "-createdAt" | "updatedAt";
  /** 1–100, default 25. */
  limit?: number;
  cursor?: string;
}

export interface ListCaseTypesParams {
  category?: string;
  /** Free-text search on the name. */
  q?: string;
  sort?: string;
  limit?: number;
  cursor?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * An error response from the API (RFC 9457 problem details).
 * Branch on `code`, which never changes, e.g. `not-found`, `invalid-parameter`, `insufficient-scope`.
 */
export class CenturoApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    readonly requestId?: string,
    readonly errors?: { parameter: string; message: string }[],
  ) {
    super(`${status} ${title}${detail ? `: ${detail}` : ""}${requestId ? ` (request ${requestId})` : ""}`);
    this.name = "CenturoApiError";
  }
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export interface CenturoClientOptions {
  clientId: string;
  clientSecret: string;
  /** The API host, e.g. `https://qat-api-goglobal.centuroglobal.com`. */
  apiUrl: string;
  /** Defaults to `${apiUrl}/oauth2/token`. */
  tokenUrl?: string;
  /**
   * The scopes to ask for, from those your key was given. A token only carries the scopes you ask for,
   * so leave out one you need and calls that need it return 403 `insufficient-scope`. Default: `["cases:read"]`.
   */
  scopes?: string[];
}

type Query = Record<string, string | number | boolean | Range | undefined>;

export class CenturoClient {
  private readonly apiUrl: string;
  private readonly tokenUrl: string;
  private token?: { value: string; expiresAt: number };
  private pendingToken?: Promise<string>;

  constructor(private readonly options: CenturoClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/+$/, "");
    this.tokenUrl = options.tokenUrl ?? `${this.apiUrl}/oauth2/token`;
  }

  /** Builds a client from CENTURO_CLIENT_ID, CENTURO_CLIENT_SECRET and CENTURO_API_URL. */
  static fromEnv(env: Record<string, string | undefined> = process.env): CenturoClient {
    const missing = ["CENTURO_CLIENT_ID", "CENTURO_CLIENT_SECRET"].filter((name) => !env[name]);
    if (missing.length > 0) {
      throw new Error(`Set ${missing.join(" and ")} in your .env file. See .env.example.`);
    }
    return new CenturoClient({
      clientId: env.CENTURO_CLIENT_ID!,
      clientSecret: env.CENTURO_CLIENT_SECRET!,
      apiUrl: env.CENTURO_API_URL || "https://qat-api-goglobal.centuroglobal.com",
      scopes: env.CENTURO_SCOPES?.split(/[\s,]+/).filter(Boolean),
    });
  }

  // --- Endpoints ------------------------------------------------------------

  /** Who the API thinks you are: your key, its scopes and your company. A good first call. */
  me(): Promise<Me> {
    return this.get("/v1/me");
  }

  readonly cases = {
    /** One page of your company's cases. */
    list: (params: ListCasesParams = {}) => this.get<ListResponse<Case>>("/v1/cases", { ...params }),
    /** One case by its `id`. Throws `CenturoApiError` with code `not-found` if it isn't yours or doesn't exist. */
    get: (id: string) => this.get<Case>(`/v1/cases/${encodeURIComponent(id)}`),
    /** Every matching case, fetching the next page only when you need it. */
    all: (params: Omit<ListCasesParams, "cursor"> = {}) =>
      this.paginate((cursor) => this.cases.list({ ...params, cursor })),
  };

  readonly caseTypes = {
    list: (params: ListCaseTypesParams = {}) => this.get<ListResponse<CaseType>>("/v1/case-types", { ...params }),
    get: (id: string) => this.get<CaseType>(`/v1/case-types/${encodeURIComponent(id)}`),
    all: (params: Omit<ListCaseTypesParams, "cursor"> = {}) =>
      this.paginate((cursor) => this.caseTypes.list({ ...params, cursor })),
  };

  // --- Plumbing --------------------------------------------------------------

  /** Calls any GET endpoint. Use this for endpoints added after this client was written. */
  async get<T>(path: string, query: Query = {}): Promise<T> {
    const url = new URL(this.apiUrl + path);
    for (const [name, value] of Object.entries(query)) {
      if (value === undefined) continue;
      if (typeof value === "object") {
        // Ranges are sent as e.g. updatedAt[gte]=2026-01-01
        for (const [op, bound] of Object.entries(value)) {
          if (bound !== undefined) url.searchParams.set(`${name}[${op}]`, bound);
        }
      } else {
        url.searchParams.set(name, String(value));
      }
    }
    return this.send<T>(url);
  }

  private async send<T>(url: URL, attempt = 1): Promise<T> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${await this.accessToken()}`, Accept: "application/json" },
    });

    // The token was revoked or expired early: get a new one and try once more.
    if (response.status === 401 && attempt === 1) {
      this.token = undefined;
      return this.send(url, attempt + 1);
    }

    // Rate limited: wait until the window resets, then try once more.
    if (response.status === 429 && attempt === 1) {
      const seconds = Number(response.headers.get("RateLimit-Reset") ?? response.headers.get("Retry-After") ?? 5);
      await new Promise((resolve) => setTimeout(resolve, Math.min(seconds, 60) * 1000));
      return this.send(url, attempt + 1);
    }

    if (!response.ok) throw await toError(response);
    return (await response.json()) as T;
  }

  private async *paginate<T>(page: (cursor?: string) => Promise<ListResponse<T>>): AsyncGenerator<T> {
    let cursor: string | undefined;
    do {
      const result = await page(cursor);
      yield* result.data;
      cursor = result.pagination.hasMore ? result.pagination.nextCursor : undefined;
    } while (cursor);
  }

  /** Returns a valid access token, fetching a new one a minute before the old one expires. */
  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    // If several requests start at once, they share one token request.
    this.pendingToken ??= this.fetchToken().finally(() => (this.pendingToken = undefined));
    return this.pendingToken;
  }

  private async fetchToken(): Promise<string> {
    const basic = btoa(`${encodeURIComponent(this.options.clientId)}:${encodeURIComponent(this.options.clientSecret)}`);
    const response = await fetch(this.tokenUrl, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: (this.options.scopes ?? ["cases:read"]).join(" "),
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string; error_description?: string };
      const hint =
        body.error === "invalid_client"
          ? "Check CENTURO_CLIENT_ID and CENTURO_CLIENT_SECRET, and that the key hasn't been revoked."
          : body.error === "invalid_scope"
            ? "Your key wasn't given one of the scopes asked for. Check CENTURO_SCOPES."
            : body.error_description;
      throw new CenturoApiError(response.status, body.error ?? "token-request-failed", "Could not get an access token", hint);
    }
    const body = (await response.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
    return body.access_token;
  }
}

async function toError(response: Response): Promise<CenturoApiError> {
  const problem = (await response.json().catch(() => ({}))) as {
    type?: string;
    title?: string;
    detail?: string;
    requestId?: string;
    errors?: { parameter: string; message: string }[];
  };
  // `type` is a URL such as https://developer.centuroglobal.com/errors/not-found; its last part is the code.
  const code = problem.type?.split("/").pop() || `http-${response.status}`;
  return new CenturoApiError(
    response.status,
    code,
    problem.title ?? response.statusText,
    problem.detail,
    problem.requestId,
    problem.errors,
  );
}
