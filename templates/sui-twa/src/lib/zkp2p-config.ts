export interface Zkp2pRuntimeConfig {
  providersBaseUrl: string;
  curatorApiUrl: string;
  attestationServiceUrl: string;
  attestorWsUrl: string;
  referrer: string;
  referrerLogoUrl: string | null;
  callbackUrl: string | null;
  consoleLogging: boolean;
  waitForProof: boolean;
  proofTimeoutMs: number;
}

const DEFAULTS = {
  providersBaseUrl: "https://mobile.zkp2p.xyz/providers/",
  curatorApiUrl: "https://api.zkp2p.xyz",
  attestationServiceUrl: "https://attestation-service.zkp2p.xyz",
  attestorWsUrl: "wss://attestor.zkp2p.xyz/ws",
  referrer: "ThunderBun",
  proofTimeoutMs: 8 * 60 * 1000,
} as const;

function readStringEnv(name: string): string | null {
  const value = import.meta.env[name] as string | undefined;
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = readStringEnv(name);
  if (!value) return fallback;
  const normalized = value.toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

function readNumberEnv(name: string, fallback: number): number {
  const value = readStringEnv(name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

export function getZkp2pRuntimeConfig(): Zkp2pRuntimeConfig {
  const providersBaseUrl = withTrailingSlash(
    readStringEnv("VITE_ZKP2P_PROVIDERS_BASE_URL") ?? DEFAULTS.providersBaseUrl,
  );

  return {
    providersBaseUrl,
    curatorApiUrl: readStringEnv("VITE_ZKP2P_CURATOR_API_URL") ?? DEFAULTS.curatorApiUrl,
    attestationServiceUrl: readStringEnv("VITE_ZKP2P_ATTESTATION_SERVICE_URL") ?? DEFAULTS.attestationServiceUrl,
    attestorWsUrl: readStringEnv("VITE_ZKP2P_ATTESTOR_WS_URL") ?? DEFAULTS.attestorWsUrl,
    referrer: readStringEnv("VITE_ZKP2P_REFERRER") ?? DEFAULTS.referrer,
    referrerLogoUrl: readStringEnv("VITE_ZKP2P_REFERRER_LOGO_URL"),
    callbackUrl: readStringEnv("VITE_ZKP2P_CALLBACK_URL"),
    consoleLogging: readBooleanEnv("VITE_ZKP2P_CONSOLE_LOGGING", false),
    waitForProof: readBooleanEnv("VITE_ZKP2P_WAIT_FOR_PROOF", true),
    proofTimeoutMs: readNumberEnv("VITE_ZKP2P_PROOF_TIMEOUT_MS", DEFAULTS.proofTimeoutMs),
  };
}

export function buildProvidersLink(path?: string): string {
  const cfg = getZkp2pRuntimeConfig();
  const normalizedPath = path ? path.replace(/^\//, "") : "";
  return new URL(normalizedPath, cfg.providersBaseUrl).toString();
}
