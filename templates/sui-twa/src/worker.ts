/**
 * ThunderBun Cloudflare Worker entry point
 *
 * Responsibilities:
 *   1. Route /agents/* requests to the appropriate Durable Object agent via
 *      `routeAgentRequest` from the `agents` SDK.
 *   2. Serve all other requests (the Vite-built PWA) from the ASSETS binding,
 *      with SPA fallback configured in wrangler.toml.
 *
 * Docs:
 *   Workers:       https://developers.cloudflare.com/workers/
 *   agents SDK:    https://github.com/cloudflare/agents
 *   Static assets: https://developers.cloudflare.com/workers/static-assets/
 */

import { routeAgentRequest } from "agents";
import { ProofAgent } from "./agents/ProofAgent";

// Re-export agent class so Wrangler can register the Durable Object.
// Every Agent subclass used in wrangler.toml [[durable_objects.bindings]]
// MUST be exported from the Worker's main module.
export { ProofAgent };

export interface Env {
  /** Bound to the Vite dist/ folder — serves static assets with SPA fallback */
  ASSETS: Fetcher;

  /** Durable Object namespace for the ProofAgent (declared in wrangler.toml) */
  ProofAgent: DurableObjectNamespace<ProofAgent>;

  /** Plain var from wrangler.toml [vars] — "testnet" | "mainnet" */
  NETWORK: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS pre-flight for agent WebSocket upgrades and RPC calls
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Upgrade",
        },
      });
    }

    // Route /agents/* to the agents SDK.
    // The SDK matches the path pattern /agents/<AgentName>/<instanceId> and
    // forwards to the correct Durable Object, handling WebSocket upgrades,
    // RPC calls (@callable methods), and state sync automatically.
    if (url.pathname.startsWith("/agents/")) {
      const agentResponse = await routeAgentRequest(request, env);
      if (agentResponse) return agentResponse;
    }

    // All other requests → static PWA assets (dist/).
    // wrangler.toml sets not_found_handling = "single-page-application" so
    // missing paths (e.g. /proof/abc) serve index.html for client-side routing.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
