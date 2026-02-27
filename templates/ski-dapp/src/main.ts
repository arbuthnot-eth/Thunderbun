import "./style.css";
import "sui.ski/styles";
import "./init-waap";
import { initReactDappKitIsland } from "./react/dapp-kit-island";
import { mountSkiWalletWidget } from "./ski-widget";

const CRITICAL_CACHE_RESET_VERSION = "2026-02-20-root-canonical-cache-fix";
const CACHE_RESET_DONE_KEY = "tb_critical_cache_reset_done";
const CACHE_RESET_RELOAD_PREFIX = "tb_critical_cache_reset_reloaded";
const HARD_RESET_PARAM = "tb_hard_reset";

void bootstrapApp();

async function bootstrapApp(): Promise<void> {
  const hardResetRequested = hasHardResetParam();
  const isReloading = await runCriticalCacheReset(hardResetRequested);
  if (isReloading) return;
  if (hardResetRequested) {
    stripHardResetParamFromUrl();
  }
  initReactDappKitIsland();
  void mountSkiWalletWidget();
}

function hasHardResetParam(): boolean {
  try {
    return new URL(window.location.href).searchParams.has(HARD_RESET_PARAM);
  } catch {
    return false;
  }
}

function stripHardResetParamFromUrl(): void {
  try {
    const nextUrl = new URL(window.location.href);
    if (!nextUrl.searchParams.has(HARD_RESET_PARAM)) return;
    nextUrl.searchParams.delete(HARD_RESET_PARAM);
    const nextSearch = nextUrl.searchParams.toString();
    const canonicalPath = `${nextUrl.pathname}${nextSearch ? `?${nextSearch}` : ""}${nextUrl.hash}`;
    window.history.replaceState(window.history.state, "", canonicalPath || "/");
  } catch {
    /* ignore */
  }
}

async function runCriticalCacheReset(force: boolean): Promise<boolean> {
  let alreadyDone = false;
  try {
    alreadyDone =
      window.localStorage.getItem(CACHE_RESET_DONE_KEY) ===
      CRITICAL_CACHE_RESET_VERSION;
  } catch {
    alreadyDone = false;
  }
  if (alreadyDone && !force) return false;

  let touched = false;

  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      if (regs.length > 0) {
        await Promise.all(regs.map((r) => r.unregister()));
        touched = true;
      }
    }
  } catch (err) {
    console.warn("[cache-reset] failed to unregister service workers:", err);
  }

  try {
    const cacheApi = window.caches;
    if (cacheApi) {
      const names = await cacheApi.keys();
      if (names.length > 0) {
        await Promise.all(names.map((name) => cacheApi.delete(name)));
        touched = true;
      }
    }
  } catch (err) {
    console.warn("[cache-reset] failed to clear caches:", err);
  }

  try {
    window.localStorage.setItem(
      CACHE_RESET_DONE_KEY,
      CRITICAL_CACHE_RESET_VERSION,
    );
  } catch {
    /* ignore */
  }

  if (!touched) return false;

  const reloadKey = `${CACHE_RESET_RELOAD_PREFIX}:${CRITICAL_CACHE_RESET_VERSION}`;
  let alreadyReloaded = false;
  try {
    alreadyReloaded = window.sessionStorage.getItem(reloadKey) === "1";
    if (!alreadyReloaded) {
      window.sessionStorage.setItem(reloadKey, "1");
    }
  } catch {
    alreadyReloaded = false;
  }

  if (!alreadyReloaded) {
    window.location.reload();
    return true;
  }
  return false;
}

export type SectionId =
  | "base" | "suins" | "walrus" | "deepbook"
  | "seal" | "nft" | "zkproof" | "ika" | "crosschain" | "passkeys" | "settings";

interface NavItem {
  id: SectionId;
  label: string;
  icon: string;
  group: "core" | "ecosystem" | "more";
}

const NAV: NavItem[] = [
  { id: "base",     label: "Base",           icon: "⚡", group: "core" },
  { id: "settings", label: "Settings",       icon: "⚙️", group: "more" },
  { id: "suins",    label: "SuiNS",          icon: "🔖", group: "ecosystem" },
  { id: "walrus",   label: "Walrus Storage", icon: "🐋", group: "ecosystem" },
  { id: "deepbook", label: "DeepBook",       icon: "📖", group: "ecosystem" },
  { id: "seal",     label: "Seal Encrypt",   icon: "🔒", group: "ecosystem" },
  { id: "passkeys", label: "Passkeys",       icon: "🔑", group: "ecosystem" },
  { id: "ika",        label: "Ika MPC",        icon: "🔐", group: "ecosystem" },
  { id: "crosschain", label: "Cross-Chain",    icon: "🌉", group: "ecosystem" },
  { id: "nft",      label: "TradePort NFTs", icon: "🖼", group: "ecosystem" },
  { id: "zkproof",  label: "Proof Verifier",  icon: "🔬", group: "ecosystem" },
];

const EXTERNAL: { label: string; href: string; icon: string }[] = [
  { label: "WaaP Wallet",  href: "https://docs.waap.xyz",              icon: "👛" },
  { label: "dApp Kit",     href: "https://sdk.mystenlabs.com/dapp-kit", icon: "🔌" },
  { label: "MVR Packages", href: "https://www.moveregistry.com",        icon: "📦" },
  { label: "Nautilus TEE", href: "https://docs.sui.io/guides/developer/nautilus", icon: "⚓" },
  { label: "Shinami Gas",  href: "https://shinami.com",                icon: "⛽" },
];

const RENDERERS: Record<SectionId, () => Promise<{ default: (el: HTMLElement) => void }>> = {
  base:     () => import("./sections/home").then(m => ({ default: m.renderHome })),
  suins:    () => import("./sections/suins").then(m => ({ default: m.renderSuiNS })),
  walrus:   () => import("./sections/walrus").then(m => ({ default: m.renderWalrus })),
  deepbook: () => import("./sections/deepbook").then(m => ({ default: m.renderDeepBook })),
  seal:     () => import("./sections/seal").then(m => ({ default: m.renderSeal })),
  passkeys: () => import("./sections/passkeys").then(m => ({ default: m.renderPasskeys })),
  ika:        () => import("./sections/ika").then(m => ({ default: m.renderIka })),
  crosschain: () => import("./sections/crosschain").then(m => ({ default: m.renderCrosschain })),
  nft:      () => import("./sections/nft").then(m => ({ default: m.renderNFT })),
  zkproof:  () => import("./sections/zkproof").then(m => ({ default: m.renderZkProof })),
  settings: () => import("./sections/settings").then(m => ({ default: m.renderSettings })),
};

class App {
  private current: SectionId = "base";

  private main: HTMLElement;

  constructor() {
    this.main = document.getElementById("main-content")!;
    this.setupSidebarDrawer();
    this.buildNav();
    this.showSection("base");
    (window as unknown as Record<string, unknown>).__app = this;
  }

  async showSection(id: SectionId) {
    this.current = id;
    
    document.querySelectorAll(".nav-item[data-id]").forEach((el) => {
      (el as HTMLElement).classList.toggle("active", (el as HTMLElement).dataset["id"] === id);
    });

    this.main.innerHTML = '<div class="loading-center"><div class="spinner"></div><p>Loading module...</p></div>';
    
    try {
      const module = await RENDERERS[id]();
      if (this.current !== id) return; // user navigated away
      this.main.innerHTML = "";
      module.default(this.main);
    } catch (err) {
      if (this.current !== id) return;
      console.error(err);
      this.main.innerHTML = `<div class="section"><div class="error-msg visible">Failed to load section: ${err}</div></div>`;
    }
  }

  private buildNav() {
    const groups: Record<"core" | "ecosystem" | "more", HTMLElement | null> = {
      core:      document.getElementById("nav-core"),
      ecosystem: document.getElementById("nav-ecosystem"),
      more:      document.getElementById("nav-more"),
    };

    for (const item of NAV) {
      const btn = document.createElement("button");
      btn.className = "nav-item";
      btn.dataset["id"] = item.id;
      btn.innerHTML = `<span class="nav-item-icon">${item.icon}</span>${item.label}`;
      btn.addEventListener("click", () => this.showSection(item.id));
      groups[item.group]?.appendChild(btn);
    }

    for (const ext of EXTERNAL) {
      const a = document.createElement("a");
      a.className = "nav-item";
      a.href = ext.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.innerHTML = `<span class="nav-item-icon">${ext.icon}</span>${ext.label}<span class="nav-item-ext">↗</span>`;
      document.getElementById("nav-more")?.appendChild(a);
    }

    const sidebar = document.getElementById("sidebar");
    sidebar?.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement;
      if (target.closest(".nav-item")) {
        this.closeSidebarDrawer();
      }
    });
  }

  private setupSidebarDrawer() {
    const openBtn = document.getElementById("sidebar-dock-toggle");
    const closeBtn = document.getElementById("sidebar-close");
    const backdrop = document.getElementById("sidebar-backdrop");

    openBtn?.addEventListener("click", () => {
      document.body.classList.add("sidebar-open");
    });

    closeBtn?.addEventListener("click", () => this.closeSidebarDrawer());
    backdrop?.addEventListener("click", () => this.closeSidebarDrawer());

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") this.closeSidebarDrawer();
    });
  }

  private closeSidebarDrawer() {
    document.body.classList.remove("sidebar-open");
  }

}

export const app = new App();

const splash = document.getElementById("splash");
if (splash) {
  document.getElementById("app")!.classList.add("ready");
  splash.classList.add("fade");
  splash.addEventListener("transitionend", () => splash.remove());
}
