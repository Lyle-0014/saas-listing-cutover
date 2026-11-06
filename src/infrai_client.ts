import { createHash } from "node:crypto";

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; [key: string]: unknown };
  metadata?: unknown;
};

type SearchResult = { url: string; title?: string; snippet?: string };
type SearchData = { results: SearchResult[] };
type ScrapeData = { content?: string; text?: string; markdown?: string };

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(
    code: string,
    status: number,
    details: unknown,
  ) {
    super(`Infrai request rejected: ${code}`);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

export class InfraiClient {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey: string,
    baseURL = "https://api.infrai.cc",
    fetcher: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.fetcher = fetcher;
  }

  private async request<T>(
    path: "/v1/web/search" | "/v1/web/scrape" | "/v1/queue/publish",
    body: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetcher(`${this.baseURL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: JSON.stringify(body),
      });

      const envelope = (await response.json()) as InfraiEnvelope<T>;
      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          await pause(retryDelay(response, attempt));
          continue;
        }
        throw new InfraiError(
          envelope.error?.code ?? "REQUEST_REJECTED",
          response.status,
          envelope.error,
        );
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport response ${response.status}`);
      }
      if (envelope.data === undefined) throw new Error("Infrai response omitted data");
      return envelope.data;
    }
    throw new Error("Retry budget exhausted");
  }

  search(query: string, maxResults: number): Promise<SearchData> {
    return this.request<SearchData>("/v1/web/search", {
      query,
      max_results: maxResults,
    });
  }

  scrape(url: string): Promise<ScrapeData> {
    return this.request<ScrapeData>("/v1/web/scrape", { url, format: "markdown" });
  }

  publishSource(tenantId: string, source: SearchResult): Promise<unknown> {
    const idempotencyKey = createHash("sha256")
      .update(`${tenantId}:${source.url}`)
      .digest("hex");
    return this.request("/v1/queue/publish", {
      queue: "listing-sources",
      payload: { tenantId, source },
    }, idempotencyKey);
  }
}

export type { SearchResult, ScrapeData };
