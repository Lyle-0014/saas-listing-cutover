import type { InfraiClient, SearchResult } from "./infrai_client.js";

export type ListingPreview = {
  sourceUrl: string;
  title: string;
  excerpt: string;
};

export type OnboardingResult = {
  tenantId: string;
  state: "active";
  queuedSources: number;
  listings: ListingPreview[];
};

export async function onboardListingTenant(
  client: Pick<InfraiClient, "search" | "publishSource" | "scrape">,
  input: { tenantId: string; market: string; maxSources: number },
): Promise<OnboardingResult> {
  const found = await client.search(`${input.market} B2B SaaS`, input.maxSources);
  const sources = uniqueByUrl(found.results).slice(0, input.maxSources);

  await Promise.all(sources.map((source) => client.publishSource(input.tenantId, source)));

  const settled = await Promise.allSettled(sources.map(async (source) => {
    const page = await client.scrape(source.url);
    const content = page.markdown ?? page.text ?? page.content ?? "";
    return {
      sourceUrl: source.url,
      title: source.title ?? source.url,
      excerpt: content.replace(/\s+/g, " ").trim().slice(0, 280),
    };
  }));

  return {
    tenantId: input.tenantId,
    state: "active",
    queuedSources: sources.length,
    listings: settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []),
  };
}

function uniqueByUrl(results: SearchResult[]): SearchResult[] {
  return [...new Map(results.map((result) => [result.url, result])).values()];
}
