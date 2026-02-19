import "./style.css";
import { wallet } from "./wallet";
import { renderHome } from "./sections/home";
import { renderSuiNS } from "./sections/suins";
import { renderWalrus } from "./sections/walrus";
import { renderDeepBook } from "./sections/deepbook";
import { renderNFT } from "./sections/nft";
import { renderSettings } from "./sections/settings";

type SectionId = "home" | "suins" | "walrus" | "deepbook" | "nft" | "settings";

interface NavItem {
  id: SectionId;
  label: string;
  icon: string;
  ecosystem?: boolean;
  href?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home", icon: "⚡" },
  { id: "suins", label: "SuiNS", icon: "🔖", ecosystem: true },
  { id: "walrus", label: "Walrus Storage", icon: "🐋", ecosystem: true },
  { id: "deepbook", label: "DeepBook", icon: "📖", ecosystem: true },
  { id: "nft", label: "TradePort NFTs", icon: "🖼", ecosystem: true },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

const ECOSYSTEM_LINKS: { label: string; href: string; icon: string }[] = [
  { label: "WaaP Wallet", href: "https://docs.waap.xyz", icon: "👛" },
  { label: "Ika MPC", href: "https://ika.xyz", icon: "🔐" },
  { label: "Seal Encrypt", href: "https://seal.sui.io", icon: "🔒" },
  { label: "MVR Packages", href: "https://mvr.app", icon: "📦" },
  { label: "Shinami Gas", href: "https://shinami.com", icon: "⛽" },
];

const SECTION_RENDERERS: Record<SectionId, (container: HTMLElement) => void> = {
  home: renderHome,
  suins: renderSuiNS,
  walrus: renderWalrus,
  deepbook: renderDeepBook,
  nft: renderNFT,
  settings: renderSettings,
};

class App {
  private currentSection: SectionId = "home";
  private mainContent: HTMLElement;

  constructor() {
    this.mainContent = document.getElementById("main-content")!;
    this.buildNav();
    this.buildEcosystemLinks();
    this.watchWallet();
    this.showSection("home");

    // Expose for onclick usage in HTML
    (window as unknown as Record<string, unknown>).app = this;
  }

  buildNav() {
    const container = document.getElementById("nav-links")!;
    NAV_ITEMS.filter((n) => !n.ecosystem && n.id !== "settings").forEach((item) => {
      container.appendChild(this.makeNavEl(item));
    });
  }

  buildEcosystemLinks() {
    const ecoContainer = document.getElementById("ecosystem-links")!;

    // In-app ecosystem sections
    NAV_ITEMS.filter((n) => n.ecosystem).forEach((item) => {
      ecoContainer.appendChild(this.makeNavEl(item));
    });

    // External links
    ECOSYSTEM_LINKS.forEach(({ label, href, icon }) => {
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "nav-item";
      a.innerHTML = `<span>${icon}</span><span>${label}</span><span class="ml-auto text-sui-border text-xs">↗</span>`;
      ecoContainer.appendChild(a);
    });

    // Settings at the bottom
    const nav = document.getElementById("nav-links")!;
    nav.appendChild(this.makeNavEl(NAV_ITEMS.find((n) => n.id === "settings")!));
  }

  private makeNavEl(item: NavItem): HTMLElement {
    const el = document.createElement("button");
    el.id = `nav-${item.id}`;
    el.className = "nav-item w-full text-left";
    el.innerHTML = `<span>${item.icon}</span><span>${item.label}</span>`;
    el.addEventListener("click", () => this.showSection(item.id));
    return el;
  }

  showSection(id: SectionId) {
    this.currentSection = id;
    this.mainContent.innerHTML = "";

    const renderer = SECTION_RENDERERS[id];
    renderer(this.mainContent);

    // Update active nav state
    document.querySelectorAll(".nav-item").forEach((el) => {
      el.classList.toggle("active", el.id === `nav-${id}`);
    });
  }

  private watchWallet() {
    wallet.subscribe((state) => {
      const disconnected = document.getElementById("wallet-disconnected");
      const connected = document.getElementById("wallet-connected");
      const addrEl = document.getElementById("wallet-address");
      const balEl = document.getElementById("wallet-balance");

      if (state.connected && state.address) {
        disconnected?.classList.add("hidden");
        connected?.classList.remove("hidden");
        if (addrEl) addrEl.textContent = wallet.formatAddress();
        if (balEl) balEl.textContent = wallet.formatBalance();
      } else {
        disconnected?.classList.remove("hidden");
        connected?.classList.add("hidden");
      }
    });
  }
}

const app = new App();
export { app };
