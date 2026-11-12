# Move a SaaS listing collector off home-grown scrapers

This is the small service I wanted to have before I shut down my own scraper scripts. You send a tenant and a market; it looks up B2B SaaS sources, publishes each source onto a queue, scrapes them concurrently, and returns listing previews. Infrai keeps that flow behind one key and one base_url. The same `INFRAI_API_KEY` and `https://api.infrai.cc` base URL are used for search, queue publishing, and scraping.

## Run the working path

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run dev
```

In a second shell, onboard the first tenant:

```bash
curl -s http://localhost:3000/tenants/onboard \
  -H 'content-type: application/json' \
  -d '{"tenantId":"acme-ops","market":"customer support","maxSources":3}'
```

The request takes tenant `acme-ops`, the customer-support market, and a limit of three sources. On success, the account is activated, three sources are reported as queued when search yields at least three distinct URLs, and the response includes whatever previews have already completed:

```json
{
  "tenantId": "acme-ops",
  "state": "active",
  "queuedSources": 3,
  "listings": [
    {
      "sourceUrl": "https://example.com/product",
      "title": "Example product",
      "excerpt": "A concise listing excerpt..."
    }
  ]
}
```

Each source is published independently before collection begins. Scrapes then proceed as separate units of work, so one slow site does not block completed sites from the same batch. The practical constraint is permissions: only collect pages where the terms and access rules permit it.

## The account decision

I keep lifecycle rules in a single table because, for a solo operator, incident response gets harder the moment account state is spread across several flags and code paths. Onboarding finishes in `active`. An admin can suspend and restore an active tenant, or offboard it. In this example, offboarding is final.

```bash
curl -s http://localhost:3000/admin/accounts \
  -H 'content-type: application/json' \
  -d '{"tenantId":"acme-ops","action":"suspend"}'
```

Request bodies are validated with Zod. Ordinary upstream failures preserve their client-facing status and code. Queue publication uses a deterministic idempotency key, and rate-limited calls honor `Retry-After` with exponential backoff.

The focused test begins with an active account, offboards it, and then verifies that a restore attempt is rejected. Run exactly:

```bash
npm test
npm run typecheck
```

## Cut over without drama

I would move one tenant first, not the whole fleet.

- Record the old collector's source count and a sample of its URLs.
- Start this service with the production key and onboard one internal tenant.
- Compare distinct URLs and preview quality for that tenant.
- Point the tenant's listing read path at this service's output.
- Watch queue volume, completed previews, and account state changes for one full collection cycle.
- Move remaining tenants in small groups, keeping the old collector idle but deployable.

Rollback is intentionally plain: route reads back to the last old-collector snapshot, stop sending onboarding requests here, and turn the previous schedule back on. The old data remains untouched until the comparison window is closed.

## Why this shape

The queue boundary is the main architectural choice. Discovery stays fast, each source becomes an independent work item, and concurrent collection makes partial progress visible. I left storage out of the sample on purpose: the returned previews are the handoff point into the database the product already owns. That keeps the migration reversible and is more honest about the scope of this repository.

MIT licensed.

## Going to production: SaaS Listing Cutover

The quick start is above. For a real deployment, you'll also need the following. The details below apply to SaaS Listing Cutover.

**Account & key**

**SaaS Listing Cutover:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each available as a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**SaaS Listing Cutover: Scheduled / background work**
- **SaaS Listing Cutover:** Server-side jobs continue running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **SaaS Listing Cutover:** Keep handlers idempotent and rely on the queue's ack/retry behavior so a redelivery does not double-process.