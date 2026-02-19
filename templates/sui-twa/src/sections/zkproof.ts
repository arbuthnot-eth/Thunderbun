/**
 * zkproof.ts — Proof verifier section
 *
 * Links to the on-chain proof_verifier contract (Groth16 + Ligetron via recursion).
 * Full Ligetron pipeline UI can be restored when zkproof-pipeline is updated.
 */

import { wallet } from "../wallet";
import { getSectionSource } from "../source-files";
import { codeViewerHTML, attachCodeViewer } from "../components/code-viewer";

const PACKAGE_ID = "0x8f96dea09cc8aee22346da38cf018428172a5efcc76b8ca6f3d83886b3f4b0e1";
const REGISTRY_ID = "0x66c001da96d3f6934f658056c2c9cd83b257dccef35f196f1ddcee11e922b682";

export function renderZkProof(container: HTMLElement): void {
  const network = wallet.getState().network;
  const explorer =
    network === "mainnet"
      ? "https://suiscan.xyz"
      : network === "testnet"
        ? "https://suiscan.xyz/testnet"
        : "https://suiscan.xyz/devnet";

  container.innerHTML = `
    <h1 class="page-title">Proof Verifier</h1>
    <p class="page-subtitle">
      Verify Groth16 and Ligetron proofs on Sui. The proof_verifier contract is deployed
      on testnet — register your circuit's verification key, then submit proofs.
    </p>

    <div class="card">
      <h3 class="card-title">On-chain verifier</h3>
      <p style="font-size:0.9rem;color:var(--text-muted);margin-bottom:var(--space-3);">
        Package and registry are live on testnet:
      </p>
      <div class="result-box" style="margin-bottom:var(--space-2);">
        <div class="result-label">Package</div>
        <div class="result-value mono" style="font-size:0.75rem;word-break:break-all;">${PACKAGE_ID}</div>
      </div>
      <div class="result-box">
        <div class="result-label">Registry (shared)</div>
        <div class="result-value mono" style="font-size:0.75rem;word-break:break-all;">${REGISTRY_ID}</div>
      </div>
      <div style="margin-top:var(--space-3);">
        <a href="${explorer}/object/${REGISTRY_ID}" target="_blank" rel="noopener" class="btn btn-secondary">View on SuiScan ↗</a>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">Ligetron zkVM pipeline</h3>
      <p style="font-size:0.9rem;color:var(--text-muted);">
        In-browser Ligetron proving + Seal + Walrus + DeepBook pipeline is being updated
        for the latest SDKs. Use the on-chain verifier above for Groth16 proofs today.
      </p>
      <a href="https://github.com/ligeroinc/ligero-prover" target="_blank" rel="noopener" class="badge badge-blue">Ligetron SDK ↗</a>
    </div>

    <div class="info-links">
      <div class="info-links-label">Resources</div>
      <div class="info-links-row">
        <a href="https://docs.sui.io/guides/developer/cryptography/groth16" target="_blank" rel="noopener" class="badge badge-blue">Sui Groth16 ↗</a>
        <a href="https://ligero-inc.com" target="_blank" rel="noopener" class="badge badge-blue">Ligero / Ligetron ↗</a>
      </div>
    </div>
  `;

  const src = getSectionSource("zkproof");
  if (src) {
    const cfg = { id: "zkproof-src", label: "zkproof.ts", source: src };
    container.insertAdjacentHTML("beforeend", codeViewerHTML(cfg));
    attachCodeViewer(container, cfg);
  }
}
