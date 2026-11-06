import { createServer } from "node:http";
import { z } from "zod";
import { applyAdminAction, type AccountState } from "./account_lifecycle.js";
import { InfraiClient, InfraiError } from "./infrai_client.js";
import { onboardListingTenant } from "./listing_pipeline.js";

const onboardingBody = z.object({
  tenantId: z.string().min(1),
  market: z.string().min(2),
  maxSources: z.number().int().min(1).max(10).default(5),
});

const adminBody = z.object({
  tenantId: z.string().min(1),
  action: z.enum(["activate", "suspend", "restore", "offboard"]),
});

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
const infrai = new InfraiClient(apiKey);
const accounts = new Map<string, AccountState>();

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/tenants/onboard") {
      const input = onboardingBody.parse(await readJson(request));
      if (accounts.has(input.tenantId)) return send(response, 409, { error: "Tenant already exists" });
      accounts.set(input.tenantId, "onboarding");
      try {
        const result = await onboardListingTenant(infrai, {
          tenantId: input.tenantId,
          market: input.market,
          maxSources: input.maxSources,
        });
        accounts.set(input.tenantId, result.state);
        return send(response, 201, result);
      } catch (error) {
        accounts.delete(input.tenantId);
        throw error;
      }
    }

    if (request.method === "POST" && request.url === "/admin/accounts") {
      const input = adminBody.parse(await readJson(request));
      const state = accounts.get(input.tenantId);
      if (!state) return send(response, 404, { error: "Tenant not found" });
      const next = applyAdminAction(state, input.action);
      accounts.set(input.tenantId, next);
      return send(response, 200, { tenantId: input.tenantId, state: next });
    }

    return send(response, 404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof z.ZodError) return send(response, 400, { error: "Invalid request", issues: error.issues });
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return send(response, status, { error: error.code, details: error.details });
    }
    const message = error instanceof Error ? error.message : "Request failed";
    return send(response, 409, { error: message });
  }
});

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Listing service listening on http://localhost:${port}`));
