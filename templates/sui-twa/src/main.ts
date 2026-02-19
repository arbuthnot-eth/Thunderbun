import "./style.css";
import "./init-waap";
import { wallet } from "./wallet";

export type SectionId =
  | "home" | "suins" | "walrus" | "deepbook"
  | "seal" | "nft" | "zkproof" | "ika" | "passkeys" | "settings";

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
  { id: "ika",      label: "Ika MPC",        icon: "🔐", group: "ecosystem" },
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
  ika:      () => import("./sections/ika").then(m => ({ default: m.renderIka })),
  nft:      () => import("./sections/nft").then(m => ({ default: m.renderNFT })),
  zkproof:  () => import("./sections/zkproof").then(m => ({ default: m.renderZkProof })),
  settings: () => import("./sections/settings").then(m => ({ default: m.renderSettings })),
};

class App {
  private current: SectionId = "home";

  private main: HTMLElement;

  constructor() {
    this.main = document.getElementById("main-content")!;
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
      this.main.innerHTML = \`<div class="section"><div class="error-msg visible">Failed to load section: \${err}</div></div>\`;
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
  }

  private watchWallet() {
    wallet.subscribe((s) => {
      const disc = document.getElementById("wallet-disconnected")!;
      const conn = document.getElementById("wallet-connected")!;
      const addr = document.getElementById("wallet-address")!;
      const bal  = document.getElementById("wallet-balance")!;

      if (s.connected && s.address) {
        disc.classList.add("hidden");
        conn.classList.remove("hidden");
        addr.textContent = wallet.formatAddress();
        bal.textContent  = wallet.formatBalance();
      } else {
        disc.classList.remove("hidden");
        conn.classList.add("hidden");
      }
    });
  }
}

export const app = new App();
