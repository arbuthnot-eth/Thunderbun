import "./style.css";
import "./init-waap";
import { wallet } from "./wallet";

export type SectionId =
  | "home" | "suins" | "walrus" | "deepbook"
  | "seal" | "nft" | "zkproof" | "ika" | "crosschain" | "passkeys" | "settings";

interface NavItem {
  id: SectionId;
  label: string;
  icon: string;
  group: "core" | "ecosystem" | "more";
}

const NAV: NavItem[] = [
  { id: "home",     label: "Home",           icon: "⚡", group: "core" },
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
  home:     () => import("./sections/home").then(m => ({ default: m.renderHome })),
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
  private current: SectionId = "home";

  private main: HTMLElement;

  constructor() {
    this.main = document.getElementById("main-content")!;
    this.setupSidebarDrawer();
    this.buildNav();
    this.watchWallet();
    this.showSection("home");
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

  private watchWallet() {
    const widgetToggleBtn = document.getElementById("wallet-widget-toggle") as HTMLButtonElement | null;
    const widgetToolbarText = document.getElementById("wallet-widget-toolbar-text");
    const disconnected = document.getElementById("wallet-widget-disconnected");
    const connected = document.getElementById("wallet-widget-connected");
    const suiAddr = document.getElementById("wallet-widget-sui");
    const baseAddr = document.getElementById("wallet-widget-base");
    const balance = document.getElementById("wallet-widget-balance");
    const connectBtn = document.getElementById("wallet-widget-connect") as HTMLButtonElement | null;
    const disconnectBtn = document.getElementById("wallet-widget-disconnect") as HTMLButtonElement | null;
    const linkBaseBtn = document.getElementById("wallet-widget-link-base") as HTMLButtonElement | null;
    const copySuiBtn = document.getElementById("wallet-widget-copy-sui") as HTMLButtonElement | null;
    const copyBaseBtn = document.getElementById("wallet-widget-copy-base") as HTMLButtonElement | null;
    const collapseStorageKey = "tb_wallet_widget_collapsed";

    const setWidgetCollapsed = (collapsed: boolean): void => {
      document.body.classList.toggle("wallet-widget-collapsed", collapsed);
      if (widgetToggleBtn) {
        widgetToggleBtn.textContent = collapsed ? "+" : "−";
        widgetToggleBtn.setAttribute("aria-label", collapsed ? "Expand wallet widget" : "Collapse wallet widget");
      }
      try {
        window.localStorage.setItem(collapseStorageKey, collapsed ? "1" : "0");
      } catch {
        /* ignore */
      }
    };

    let initialCollapsed = false;
    try {
      initialCollapsed = window.localStorage.getItem(collapseStorageKey) === "1";
    } catch {
      /* ignore */
    }
    setWidgetCollapsed(initialCollapsed);

    widgetToggleBtn?.addEventListener("click", () => {
      const next = !document.body.classList.contains("wallet-widget-collapsed");
      setWidgetCollapsed(next);
    });

    const flashButton = (btn: HTMLButtonElement | null, text: string): void => {
      if (!btn) return;
      const original = btn.textContent;
      btn.textContent = text;
      window.setTimeout(() => {
        btn.textContent = original;
      }, 900);
    };

    const copyValue = async (value: string | null, btn: HTMLButtonElement | null): Promise<void> => {
      if (!value || !btn) return;
      try {
        await navigator.clipboard.writeText(value);
        flashButton(btn, "Copied");
      } catch {
        flashButton(btn, "Failed");
      }
    };

    connectBtn?.addEventListener("click", async () => {
      connectBtn.disabled = true;
      connectBtn.textContent = "Connecting…";
      try {
        await wallet.connect();
      } catch (err) {
        console.error("[main] wallet connect failed:", err);
      } finally {
        connectBtn.disabled = false;
        connectBtn.textContent = "Connect WaaP";
      }
    });

    disconnectBtn?.addEventListener("click", () => {
      wallet.disconnectWaaP().catch((err) => console.error("[main] waap disconnect failed:", err));
    });

    linkBaseBtn?.addEventListener("click", async () => {
      linkBaseBtn.disabled = true;
      const original = linkBaseBtn.textContent;
      linkBaseBtn.textContent = "Linking…";
      try {
        await wallet.linkWaaPBaseAddress();
      } catch (err) {
        console.error("[main] link base failed:", err);
      } finally {
        linkBaseBtn.disabled = false;
        linkBaseBtn.textContent = original;
      }
    });

    copySuiBtn?.addEventListener("click", () => {
      void copyValue(suiAddr?.getAttribute("data-full") ?? null, copySuiBtn);
    });
    copyBaseBtn?.addEventListener("click", () => {
      void copyValue(baseAddr?.getAttribute("data-full") ?? null, copyBaseBtn);
    });

    wallet.subscribe((s) => {
      if (s.connected && s.address) {
        disconnected?.classList.add("is-hidden");
        connected?.classList.remove("is-hidden");

        if (suiAddr) {
          suiAddr.textContent = shortAddress(s.address);
          suiAddr.setAttribute("data-full", s.address);
        }

        if (baseAddr) {
          if (s.waapBaseAddress) {
            baseAddr.textContent = shortAddress(s.waapBaseAddress);
            baseAddr.setAttribute("data-full", s.waapBaseAddress);
          } else {
            baseAddr.textContent = "Not linked";
            baseAddr.removeAttribute("data-full");
          }
        }

        if (balance) {
          balance.textContent = wallet.formatBalance();
        }

        if (widgetToolbarText) {
          widgetToolbarText.textContent = `Connected · ${wallet.formatBalance()}`;
        }

        if (linkBaseBtn) {
          linkBaseBtn.textContent = s.waapBaseAddress ? "Re-link Base" : "Link Base";
        }

        if (copySuiBtn) copySuiBtn.disabled = false;
        if (copyBaseBtn) copyBaseBtn.disabled = !s.waapBaseAddress;
      } else {
        disconnected?.classList.remove("is-hidden");
        connected?.classList.add("is-hidden");
        if (copySuiBtn) copySuiBtn.disabled = true;
        if (copyBaseBtn) copyBaseBtn.disabled = true;
        if (widgetToolbarText) widgetToolbarText.textContent = "Wallet";
      }
    });
  }
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export const app = new App();

const splash = document.getElementById("splash");
if (splash) {
  document.getElementById("app")!.classList.add("ready");
  splash.classList.add("fade");
  splash.addEventListener("transitionend", () => splash.remove());
}
