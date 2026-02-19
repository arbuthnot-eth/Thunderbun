import "./style.css";
import { wallet } from "./wallet";
import { renderHome }     from "./sections/home";
import { renderSuiNS }    from "./sections/suins";
import { renderWalrus }   from "./sections/walrus";
import { renderDeepBook } from "./sections/deepbook";
import { renderSeal }     from "./sections/seal";
import { renderNFT }      from "./sections/nft";
import { renderSettings } from "./sections/settings";

export type SectionId =
  | "home" | "suins" | "walrus" | "deepbook"
  | "seal" | "nft" | "settings";

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
  { id: "nft",      label: "TradePort NFTs", icon: "🖼", group: "ecosystem" },
];

const EXTERNAL: { label: string; href: string; icon: string }[] = [
  { label: "WaaP Wallet",  href: "https://docs.waap.xyz",              icon: "👛" },
  { label: "MVR Packages", href: "https://www.moveregistry.com",        icon: "📦" },
  { label: "Ika MPC",      href: "https://docs.ika.xyz",               icon: "🔐" },
  { label: "Nautilus TEE", href: "https://docs.sui.io/guides/developer/nautilus", icon: "⚓" },
  { label: "Shinami Gas",  href: "https://shinami.com",                icon: "⛽" },
];

const RENDERERS: Record<SectionId, (el: HTMLElement) => void> = {
  home:     renderHome,
  suins:    renderSuiNS,
  walrus:   renderWalrus,
  deepbook: renderDeepBook,
  seal:     renderSeal,
  nft:      renderNFT,
  settings: renderSettings,
};

class App {
  private current: SectionId = "home";
  private main: HTMLElement;

  constructor() {
    this.main = document.getElementById("main-content")!;
    this.buildNav();
    this.watchWallet();
    this.showSection("home");
    (window as Record<string, unknown>).__app = this;
  }

  showSection(id: SectionId) {
    this.current = id;
    this.main.innerHTML = "";
    RENDERERS[id](this.main);

    document.querySelectorAll(".nav-item[data-id]").forEach((el) => {
      (el as HTMLElement).classList.toggle("active", (el as HTMLElement).dataset["id"] === id);
    });
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
