#!/usr/bin/env bun
/**
 * mint-pending-cctp.ts — Batch-mint all pending CCTP burns on Sui mainnet
 *
 * Fetches attestations from Circle Iris API, builds the 5-step receive_message
 * PTB for each burn, and executes on Sui. Skips burns whose nonce was already
 * consumed (already minted).
 *
 * Usage: bun scripts/mint-pending-cctp.ts
 */

import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ── Mainnet CCTP Sui contracts ──────────────────────────────────────────

const MT_PKG = "0x08d87d37ba49e785dde270a83f8e979605b03dc552b5548f26fdf2f49bf7ed1b";
const TMM_PKG = "0x2aa6c5d56376c371f88a6cc42e852824994993cb9bab8d3e6450cbe3cb32b94e";
const MT_STATE = "0xf68268c3d9b1df3215f2439400c1c4ea08ac4ef4bb7d6f3ca6a2a239e17510af";
const TMM_STATE = "0x45993eecc0382f37419864992c12faee2238f5cfe22b98ad3bf455baf65c8a2f";
const USDC_TREASURY = "0x57d6725e7a8b49a7b2a612f6bd66ab5f39fc95332ca48be421c3229d514a6de7";
const DENY_LIST = "0x403";
const USDC_TYPE = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
const TMM_AUTH = `${TMM_PKG}::message_transmitter_authenticator::MessageTransmitterAuthenticator`;

const IRIS_API = "https://iris-api.circle.com";
const BASE_DOMAIN = 6;
const SUI_MAINNET_GRPC = "https://fullnode.mainnet.sui.io:443";

// ── Burns to mint ───────────────────────────────────────────────────────

const BURN_TX_HASHES = [
  "0x1b3f4a9cdc6f149bf0c7bc306a61a143024f0cadb428e249dabc753b3d726135",
  "0x3b278495691a540decf434dfa23181a94b2ad3fa9fd1200c4e0b8b8bb758f2b2",
  "0xd8ccdcf120811aeef6297ce45a37cc47cbe0bb5c3eb5b8d7e92519ff27fa89d4",
  "0xd63a64aa31e9b4edc0c40fc0470cc5a58dbec759c92fadf355bddceee690997d",
  "0xd7765d632fd4c63723c6cf124da531a748eb94c8a4954827419f1e705ff45168",
  "0x64bc88b09a9b3707b9d41c2bfae6e8f3bb5c88be6d4cc1bc9f7771bfcadf2f64",
  "0x06b2b7e264b2d8e4e2308b75bdcb658cfb509b4774732481490089d0a9e613a7",
  "0x1fe9c1c80426f11961e14488c6d08633a6173a7df22824ecf10872fcd227d130",
  "0xfe4545db45e32212ad412a0b32f6d2d054f605337ee1fffae3976b856ea974bf",
];

// ── Helpers ─────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function loadKeypair(): Ed25519Keypair {
  // Snap-installed bun has a different $HOME — use real home from /etc/passwd
  // Try local copy first (snap sandbox can't read ~/.sui), fall back to real path
  const scriptDir = new URL(".", import.meta.url).pathname;
  const localCopy = join(scriptDir, ".sui-keystore.tmp");
  const realHome = process.env.REAL_HOME ?? process.env.SNAP_REAL_HOME ?? "/home/brandon";
  const systemPath = join(realHome, ".sui", "sui_config", "sui.keystore");
  let keystorePath: string;
  try {
    readFileSync(localCopy);
    keystorePath = localCopy;
  } catch {
    keystorePath = systemPath;
  }
  const keystore = JSON.parse(readFileSync(keystorePath, "utf-8")) as string[];

  for (const encoded of keystore) {
    const raw = Buffer.from(encoded, "base64");
    if (raw[0] === 0) {
      // ED25519 flag byte
      return Ed25519Keypair.fromSecretKey(raw.slice(1));
    }
  }
  throw new Error("No Ed25519 keypair found in ~/.sui/sui_config/sui.keystore");
}

interface IrisMessage {
  attestation: string;
  message: string;
  status: string;
  eventNonce: string;
  cctpVersion: number;
}

async function fetchAttestation(burnTxHash: string): Promise<IrisMessage | null> {
  const url = `${IRIS_API}/v2/messages/${BASE_DOMAIN}?transactionHash=${burnTxHash}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const body = (await res.json()) as { messages?: IrisMessage[] };
  const msg = body.messages?.[0];
  if (!msg || msg.status !== "complete" || !msg.attestation || !msg.message) return null;
  return msg;
}

function buildMintTx(
  messageHex: string,
  attestationHex: string,
  sender: string,
): Transaction {
  const msgBytes = Array.from(hexToBytes(messageHex));
  const attBytes = Array.from(hexToBytes(attestationHex));

  const tx = new Transaction();
  tx.setSenderIfNotSet(sender);

  // Step 1: receive_message
  const [receipt] = tx.moveCall({
    target: `${MT_PKG}::receive_message::receive_message`,
    arguments: [
      tx.pure.vector("u8", msgBytes),
      tx.pure.vector("u8", attBytes),
      tx.object(MT_STATE),
    ],
  });

  // Step 2: handle_receive_message
  const [stampReceiptTicketWithBurnMessage] = tx.moveCall({
    target: `${TMM_PKG}::handle_receive_message::handle_receive_message`,
    arguments: [
      receipt,
      tx.object(TMM_STATE),
      tx.object(DENY_LIST),
      tx.object(USDC_TREASURY),
    ],
    typeArguments: [USDC_TYPE],
  });

  // Step 3: deconstruct
  const [stampReceiptTicket] = tx.moveCall({
    target: `${TMM_PKG}::handle_receive_message::deconstruct_stamp_receipt_ticket_with_burn_message`,
    arguments: [stampReceiptTicketWithBurnMessage],
  });

  // Step 4: stamp_receipt
  const [stampedReceipt] = tx.moveCall({
    target: `${MT_PKG}::receive_message::stamp_receipt`,
    arguments: [stampReceiptTicket, tx.object(MT_STATE)],
    typeArguments: [TMM_AUTH],
  });

  // Step 5: complete_receive_message
  tx.moveCall({
    target: `${MT_PKG}::receive_message::complete_receive_message`,
    arguments: [stampedReceipt, tx.object(MT_STATE)],
  });

  tx.setGasBudget(50_000_000);
  return tx;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const keypair = loadKeypair();
  const sender = keypair.toSuiAddress();
  console.log(`Sender address: ${sender}`);
  console.log(`Minting ${BURN_TX_HASHES.length} pending CCTP burns on Sui mainnet\n`);

  const client = new SuiGrpcClient({ baseUrl: SUI_MAINNET_GRPC, network: "mainnet" });

  console.log();

  let minted = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < BURN_TX_HASHES.length; i++) {
    const burnTx = BURN_TX_HASHES[i];
    const label = `[${i + 1}/${BURN_TX_HASHES.length}]`;
    console.log(`${label} Burn: ${burnTx}`);

    // Fetch attestation from Iris
    const iris = await fetchAttestation(burnTx);
    if (!iris) {
      console.log(`${label}   SKIP — attestation not ready or not found\n`);
      skipped++;
      continue;
    }
    console.log(`${label}   Nonce: ${iris.eventNonce} | CCTP v${iris.cctpVersion}`);

    // Build and execute PTB
    const tx = buildMintTx(iris.message, iris.attestation, sender);
    try {
      const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
      });

      const digest =
        typeof result === "object" && result !== null
          ? (result as Record<string, unknown>).digest ??
            ((result as Record<string, Record<string, unknown>>).Transaction?.digest) ??
            "unknown"
          : "unknown";

      console.log(`${label}   MINTED — digest: ${digest}\n`);
      minted++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already") || msg.includes("nonce") || msg.includes("Nonce")) {
        console.log(`${label}   SKIP — nonce already used (already minted)\n`);
        skipped++;
      } else {
        console.error(`${label}   FAILED — ${msg}\n`);
        failed++;
      }
    }
  }

  console.log("────────────────────────────────────");
  console.log(`Done. Minted: ${minted} | Skipped: ${skipped} | Failed: ${failed}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
