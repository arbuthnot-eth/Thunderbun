/**
 * ProofAgent — Cloudflare Durable Object Agent for ZK proof session management
 *
 * Each instance of ProofAgent is addressed by a user-chosen name (e.g. a Sui
 * address or wallet ID).  Clients connect over WebSocket at:
 *
 *   wss://<worker>.workers.dev/agents/ProofAgent/<instance-name>
 *
 * The agent provides:
 *   • Persistent proof history (SQLite via `this.sql`)
 *   • Real-time pipeline progress broadcast to all connected clients
 *   • @callable RPC methods invocable from the browser via AgentClient
 *   • Shared state synced automatically to every connected WebSocket client
 *
 * Docs:
 *   Agent class:     https://github.com/cloudflare/agents/blob/main/docs/agent-class.md
 *   State & SQL:     https://github.com/cloudflare/agents/blob/main/docs/state.md
 *   Callable methods:https://github.com/cloudflare/agents/blob/main/docs/callable-methods.md
 *   Client (browser):https://github.com/cloudflare/agents/blob/main/docs/client.md
 */

import { Agent, callable } from "agents";
import type { Connection } from "agents";
import type { Env } from "../worker";

// ── State (synced to all connected clients via WebSocket) ─────────────────────

export interface ProofAgentState {
  /** IDs of proofs currently being processed */
  activeProofs: string[];
  /** Pipeline step label for the most recent active proof */
  pipelineStep: string | null;
  /** Unix-ms timestamp of the last successful proof submission */
  lastSubmission: number | null;
  /** Count of all verified proofs for this agent instance */
  totalVerified: number;
}

// ── SQL row types ─────────────────────────────────────────────────────────────

export interface ProofRecord {
  id: string;
  programDigest: string;
  submittedAt: number;
  txDigest: string | null;
  status: "pending" | "verified" | "failed";
  iopBlobId: string | null;
  sealBlobId: string | null;
  sealId: string | null;
  notes: string | null;
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export class ProofAgent extends Agent<Env, ProofAgentState> {
  // Initial state shape — must be JSON-serialisable.
  // Changes via this.setState() are broadcast to all connected WebSocket clients.
  initialState: ProofAgentState = {
    activeProofs: [],
    pipelineStep: null,
    lastSubmission: null,
    totalVerified: 0,
  };

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /** Called once when the Durable Object is first created (or after eviction). */
  async onStart() {
    this.sql`
      CREATE TABLE IF NOT EXISTS proofs (
        id            TEXT    PRIMARY KEY,
        program_digest TEXT   NOT NULL,
        submitted_at  INTEGER NOT NULL,
        tx_digest     TEXT,
        status        TEXT    NOT NULL DEFAULT 'pending',
        iop_blob_id   TEXT,
        seal_blob_id  TEXT,
        seal_id       TEXT,
        notes         TEXT
      )
    `;

    // Restore totalVerified from SQL so state survives evictions.
    const rows = this.sql<{ n: number }>`
      SELECT COUNT(*) as n FROM proofs WHERE status = 'verified'
    `;
    const count = [...rows][0]?.n ?? 0;
    this.setState({ ...this.state, totalVerified: count });
  }

  /** Called each time a new WebSocket client connects. */
  onConnect(connection: Connection) {
    // Send the current full state immediately so the client doesn't have to wait
    // for the next state-change event.
    connection.send(
      JSON.stringify({ type: "snapshot", data: this.state })
    );
  }

  /** Called when a WebSocket client disconnects. */
  onClose(_connection: Connection, _code: number, _reason: string) {
    // No-op — clean up any connection-local resources here if needed.
  }

  /** Called when a WebSocket client sends a raw message (not an RPC call). */
  async onMessage(_connection: Connection, message: string | ArrayBuffer) {
    // We use @callable for structured RPC; raw messages are available for
    // custom protocols (e.g. binary proof chunks streamed from the browser).
    if (typeof message === "string") {
      try {
        const parsed = JSON.parse(message) as { type?: string };
        if (parsed.type === "ping") {
          // Keep-alive — handled silently.
          return;
        }
      } catch {
        // ignore malformed messages
      }
    }
  }

  // ── @callable RPC methods (invocable from browser via AgentClient.call) ────

  /**
   * Record a successfully submitted on-chain proof.
   *
   * Call this after the PTB executes to persist the proof and update live state.
   *
   * @example (browser)
   * ```ts
   * import { AgentClient } from "agents/client";
   * const agent = new AgentClient({ agent: "ProofAgent", name: suiAddress, host: location.host });
   * const { proofId } = await agent.call("recordProof", [{
   *   programDigest, txDigest, iopBlobId, sealBlobId, sealId,
   * }]);
   * ```
   */
  @callable()
  async recordProof(params: {
    programDigest: string;
    txDigest: string;
    iopBlobId?: string;
    sealBlobId?: string;
    sealId?: string;
    notes?: string;
  }): Promise<{ proofId: string }> {
    const proofId = crypto.randomUUID();
    const now = Date.now();

    this.sql`
      INSERT INTO proofs
        (id, program_digest, submitted_at, tx_digest, status, iop_blob_id, seal_blob_id, seal_id, notes)
      VALUES
        (${proofId}, ${params.programDigest}, ${now}, ${params.txDigest},
         'verified', ${params.iopBlobId ?? null}, ${params.sealBlobId ?? null},
         ${params.sealId ?? null}, ${params.notes ?? null})
    `;

    this.setState({
      ...this.state,
      activeProofs: this.state.activeProofs.filter((id) => id !== proofId),
      lastSubmission: now,
      totalVerified: this.state.totalVerified + 1,
      pipelineStep: null,
    });

    return { proofId };
  }

  /**
   * Broadcast a pipeline progress update to all connected clients.
   * Call at each step of the ZK pipeline so the UI updates in real time.
   *
   * @example (browser — after each pipeline step)
   * ```ts
   * await agent.call("reportProgress", [{ step: "groth16", proofId }]);
   * ```
   */
  @callable()
  async reportProgress(params: {
    step: string;
    proofId?: string;
  }): Promise<void> {
    const update: Partial<ProofAgentState> = { pipelineStep: params.step };
    if (params.proofId && !this.state.activeProofs.includes(params.proofId)) {
      update.activeProofs = [...this.state.activeProofs, params.proofId];
    }
    this.setState({ ...this.state, ...update });
  }

  /**
   * Retrieve paginated proof history for this agent instance.
   *
   * @example (browser)
   * ```ts
   * const history = await agent.call("getHistory", [{ limit: 20, offset: 0 }]);
   * ```
   */
  @callable()
  async getHistory(params: {
    limit?: number;
    offset?: number;
    status?: ProofRecord["status"];
  }): Promise<ProofRecord[]> {
    const limit = params.limit ?? 20;
    const offset = params.offset ?? 0;

    if (params.status) {
      const rows = this.sql<{
        id: string;
        program_digest: string;
        submitted_at: number;
        tx_digest: string | null;
        status: string;
        iop_blob_id: string | null;
        seal_blob_id: string | null;
        seal_id: string | null;
        notes: string | null;
      }>`
        SELECT id, program_digest, submitted_at, tx_digest, status,
               iop_blob_id, seal_blob_id, seal_id, notes
        FROM   proofs
        WHERE  status = ${params.status}
        ORDER  BY submitted_at DESC
        LIMIT  ${limit} OFFSET ${offset}
      `;
      return [...rows].map(toProofRecord);
    }

    const rows = this.sql<{
      id: string;
      program_digest: string;
      submitted_at: number;
      tx_digest: string | null;
      status: string;
      iop_blob_id: string | null;
      seal_blob_id: string | null;
      seal_id: string | null;
      notes: string | null;
    }>`
      SELECT id, program_digest, submitted_at, tx_digest, status,
             iop_blob_id, seal_blob_id, seal_id, notes
      FROM   proofs
      ORDER  BY submitted_at DESC
      LIMIT  ${limit} OFFSET ${offset}
    `;
    return [...rows].map(toProofRecord);
  }

  /**
   * Fetch a single proof by its UUID.
   *
   * @example (browser)
   * ```ts
   * const proof = await agent.call("getProof", [proofId]);
   * ```
   */
  @callable()
  async getProof(proofId: string): Promise<ProofRecord | null> {
    const rows = this.sql<{
      id: string;
      program_digest: string;
      submitted_at: number;
      tx_digest: string | null;
      status: string;
      iop_blob_id: string | null;
      seal_blob_id: string | null;
      seal_id: string | null;
      notes: string | null;
    }>`
      SELECT id, program_digest, submitted_at, tx_digest, status,
             iop_blob_id, seal_blob_id, seal_id, notes
      FROM   proofs
      WHERE  id = ${proofId}
    `;
    const arr = [...rows].map(toProofRecord);
    return arr[0] ?? null;
  }

  /**
   * Delete a proof record (admin / cleanup utility).
   *
   * @example (browser)
   * ```ts
   * await agent.call("deleteProof", [proofId]);
   * ```
   */
  @callable()
  async deleteProof(proofId: string): Promise<{ deleted: boolean }> {
    this.sql`DELETE FROM proofs WHERE id = ${proofId}`;

    // Recalculate totalVerified since we might have deleted a verified proof.
    const rows = this.sql<{ n: number }>`
      SELECT COUNT(*) as n FROM proofs WHERE status = 'verified'
    `;
    const count = [...rows][0]?.n ?? 0;
    this.setState({
      ...this.state,
      activeProofs: this.state.activeProofs.filter((id) => id !== proofId),
      totalVerified: count,
    });

    return { deleted: true };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toProofRecord(row: {
  id: string;
  program_digest: string;
  submitted_at: number;
  tx_digest: string | null;
  status: string;
  iop_blob_id: string | null;
  seal_blob_id: string | null;
  seal_id: string | null;
  notes: string | null;
}): ProofRecord {
  return {
    id: row.id,
    programDigest: row.program_digest,
    submittedAt: row.submitted_at,
    txDigest: row.tx_digest,
    status: row.status as ProofRecord["status"],
    iopBlobId: row.iop_blob_id,
    sealBlobId: row.seal_blob_id,
    sealId: row.seal_id,
    notes: row.notes,
  };
}
