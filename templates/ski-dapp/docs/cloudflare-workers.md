# Cloudflare Workers + Agents — Thunderbun Guide

This document covers everything you need to deploy, extend, and operate the Thunderbun
`sui-twa` template on **Cloudflare Workers** with the **`agents` SDK**.

---

## Architecture overview

```
Browser (PWA)
    │
    │  WebSocket  wss://<worker>/agents/ProofAgent/<wallet-address>
    │  HTTP       https://<worker>/agents/ProofAgent/<wallet-address>
    │
    ▼
Cloudflare Workers (src/worker.ts)
    │
    ├─── /agents/*  ──►  routeAgentRequest(request, env)
    │                         │
    │                         ▼
    │                    ProofAgent (Durable Object)
    │                      - SQLite proof history
    │                      - WebSocket real-time state sync
    │                      - @callable RPC methods
    │
    └─── /*         ──►  env.ASSETS.fetch(request)
                              │
                              ▼
                         dist/ (Vite PWA build)
                         SPA fallback: index.html
```

Every agent instance is addressed by a **name** (e.g. the user's Sui address).
Durable Objects guarantee globally unique instances — two requests with the same name
always reach the same object, regardless of which Cloudflare data-centre handles them.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 18 | [nodejs.org](https://nodejs.org) |
| Wrangler | latest | `npm i -g wrangler` |
| Cloudflare account | — | [dash.cloudflare.com](https://dash.cloudflare.com) |

```bash
# Install project dependencies (includes agents + wrangler)
bun install   # or: npm install
```

---

## Local development

```bash
# Start the Vite dev server for the PWA (hot-reload)
bun run dev                  # http://localhost:5173

# Start the Wrangler local runtime (Worker + agents, separate port)
bun run worker:dev           # http://localhost:8787
```

During development the browser PWA (`localhost:5173`) and the Worker
(`localhost:8787`) run in separate processes.  Update `VITE_AGENT_HOST` in `.env`
to point at `localhost:8787` when testing agent features locally:

```env
# .env (not committed)
VITE_AGENT_HOST=localhost:8787
```

---

## Deploy

```bash
# 1. Build the Vite PWA into dist/
bun run build

# 2. Deploy Worker + dist/ to Cloudflare
wrangler deploy              # → https://thunderbun.<account>.workers.dev

# Deploy to a named environment
wrangler deploy --env preview     # thunderbun-preview.*
wrangler deploy --env production  # thunderbun (production)
```

Wrangler bundles `src/worker.ts` (and all imported agents) using `esbuild`, then
uploads the Worker script together with the `dist/` static assets in a single API
call.

---

## Configuration (`wrangler.toml`)

```toml
name            = "thunderbun"
main            = "src/worker.ts"           # Worker entry point
compatibility_date  = "2025-02-19"
compatibility_flags = ["nodejs_compat"]     # enables Node.js APIs

[assets]
directory          = "dist"                 # Vite build output
not_found_handling = "single-page-application"  # SPA fallback
binding            = "ASSETS"              # env.ASSETS in worker.ts

[[durable_objects.bindings]]
name       = "ProofAgent"
class_name = "ProofAgent"   # must match the exported class name

[[migrations]]
tag                = "v1"
new_sqlite_classes = ["ProofAgent"]  # gives the DO a built-in SQLite DB

[vars]
NETWORK = "testnet"          # available as env.NETWORK
```

### Secrets

Never commit API keys.  Use Wrangler secrets instead:

```bash
wrangler secret put OPENAI_API_KEY          # if using Workers AI
wrangler secret put MY_OTHER_SECRET
```

---

## Agent SDK — core concepts

### 1. `Agent` class

```typescript
import { Agent, callable } from "agents";

export class ProofAgent extends Agent<Env, MyState> {
  initialState = { count: 0 };

  async onStart() {
    // Runs once on cold start. Create SQL tables here.
    this.sql`CREATE TABLE IF NOT EXISTS ...`;
  }

  onConnect(connection: Connection) {
    // New WebSocket client joined — send current state snapshot.
    connection.send(JSON.stringify(this.state));
  }

  @callable()
  async increment(): Promise<{ count: number }> {
    this.setState({ count: this.state.count + 1 });
    return { count: this.state.count };
  }
}
```

### 2. State (`this.state` / `this.setState`)

- Stored in the Durable Object's persistent storage.
- Automatically broadcast to **all** connected WebSocket clients on change.
- Must be JSON-serialisable.

```typescript
this.setState({ ...this.state, pipelineStep: "groth16" });
```

### 3. SQL (`this.sql`)

A built-in SQLite database scoped to the Durable Object instance.

```typescript
// Tagged template — safe parameterised queries (no SQL injection)
this.sql`INSERT INTO proofs (id, status) VALUES (${id}, ${'pending'})`;

const rows = this.sql<{ id: string; status: string }>`
  SELECT id, status FROM proofs WHERE status = ${'verified'}
`;
const arr = [...rows];   // cursor → array
```

### 4. `@callable` RPC methods

Mark any method `@callable()` to expose it as an RPC endpoint callable from the
browser via `AgentClient.call(methodName, args)`.

```typescript
@callable()
async getProof(id: string): Promise<ProofRecord | null> { ... }
```

### 5. Streaming `@callable`

For long-running operations (AI generation, proof steps):

```typescript
import { callable, type StreamingResponse } from "agents";

@callable({ streaming: true })
async runPipeline(stream: StreamingResponse, config: PipelineConfig) {
  stream.send({ step: "ligetron" });
  // ... do work ...
  stream.send({ step: "groth16" });
  stream.end({ proofId: "..." });
}
```

---

## Browser client (`agents/client`)

Connect to an agent from vanilla TypeScript (no React required):

```typescript
import { AgentClient } from "agents/client";

// Create a client — one per user session.
// `name` is the Durable Object instance key (use Sui wallet address for isolation).
const proofAgent = new AgentClient({
  agent: "ProofAgent",
  name: suiWalletAddress,       // unique per user
  host: import.meta.env.VITE_AGENT_HOST ?? location.host,

  onStateUpdate(state, source) {
    // Called whenever the agent broadcasts a state change.
    // `source` is "server" (DO push) or "local" (optimistic update).
    renderAgentState(state);
  },
});

// ── RPC calls ─────────────────────────────────────────────────────────────────

// Simple call — awaits the return value
const { proofId } = await proofAgent.call("recordProof", [{
  programDigest: "0xabc...",
  txDigest: "Dy3...",
  iopBlobId: "...",
  sealBlobId: "...",
  sealId: "...",
}]);

// Streaming call — get progress events
await proofAgent.call("runPipeline", [pipelineConfig], {
  stream: {
    onChunk(chunk) { updateProgressBar(chunk.step); },
    onDone(result) { showSuccess(result.proofId); },
    onError(err) { showError(err); },
  },
});

// ── One-off HTTP (no WebSocket) ───────────────────────────────────────────────

import { agentFetch } from "agents/client";

const resp = await agentFetch({
  agent: "ProofAgent",
  name: suiWalletAddress,
  host: location.host,
}, { method: "GET" });

// ── Cleanup ───────────────────────────────────────────────────────────────────
proofAgent.close();
```

### Environment variable for the agent host

```env
# .env
VITE_AGENT_HOST=localhost:8787    # local development
# Leave unset in production — defaults to location.host (same origin)
```

---

## Adding a new Agent

1. **Create the agent class**

   ```bash
   # Create src/agents/MyAgent.ts
   ```

   ```typescript
   import { Agent, callable } from "agents";
   import type { Env } from "../worker";

   export class MyAgent extends Agent<Env, { count: number }> {
     initialState = { count: 0 };

     async onStart() {
       this.sql`CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY)`;
     }

     @callable()
     async addItem(item: string): Promise<void> {
       this.sql`INSERT OR IGNORE INTO items (id) VALUES (${item})`;
     }
   }
   ```

2. **Export from `src/worker.ts`**

   ```typescript
   export { MyAgent } from "./agents/MyAgent";
   ```

3. **Register in `wrangler.toml`**

   ```toml
   [[durable_objects.bindings]]
   name       = "MyAgent"
   class_name = "MyAgent"

   [[migrations]]
   tag                = "v2"           # bump the tag
   new_sqlite_classes = ["MyAgent"]
   ```

4. **Add TypeScript binding to `Env`** in `src/worker.ts`

   ```typescript
   export interface Env {
     ...
     MyAgent: DurableObjectNamespace<MyAgent>;
   }
   ```

---

## ProofAgent — method reference

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `recordProof` | `{ programDigest, txDigest, iopBlobId?, sealBlobId?, sealId?, notes? }` | `{ proofId: string }` | Save a verified proof to SQLite and update live state |
| `reportProgress` | `{ step: string, proofId?: string }` | `void` | Broadcast pipeline step to all connected clients |
| `getHistory` | `{ limit?, offset?, status? }` | `ProofRecord[]` | Paginated proof history |
| `getProof` | `proofId: string` | `ProofRecord \| null` | Fetch a single proof by ID |
| `deleteProof` | `proofId: string` | `{ deleted: boolean }` | Remove a proof from history |

### WebSocket URL pattern

```
wss://<your-worker>.workers.dev/agents/ProofAgent/<instance-name>
```

- `instance-name` — any string; use the user's Sui address for per-user isolation.

### State shape broadcast on every change

```typescript
interface ProofAgentState {
  activeProofs:   string[];   // UUIDs of in-flight proofs
  pipelineStep:   string | null;  // current step label
  lastSubmission: number | null;  // Unix-ms
  totalVerified:  number;
}
```

---

## Useful Wrangler commands

```bash
# View real-time logs from your deployed Worker
wrangler tail

# List all deployed Workers
wrangler list

# Delete the Worker (irreversible)
wrangler delete

# Manage secrets
wrangler secret put MY_SECRET
wrangler secret list
wrangler secret delete MY_SECRET

# Type-check the Worker source
bun run worker:typecheck
```

---

## Further reading

- [Cloudflare Workers docs](https://developers.cloudflare.com/workers/)
- [Workers static assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare Agents SDK](https://github.com/cloudflare/agents)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [Agents starter template](https://github.com/cloudflare/agents-starter)
