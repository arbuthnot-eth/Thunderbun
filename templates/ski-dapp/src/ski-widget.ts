interface SkiWalletKit {
  renderModal(containerId: string): void;
  renderWidget(containerId: string): void;
  openModal(): void;
  closeModal(): void;
  detectWallets?: () => Promise<unknown>;
  autoReconnect?: () => Promise<unknown>;
}

declare global {
  interface Window {
    SuiWalletKit?: SkiWalletKit;
    tbSkiWidgetConnected?: () => void;
    tbSkiWidgetDisconnected?: () => void;
  }
}

const SKI_STYLE_ID = "tb-ski-wallet-ui-style";
const SKI_KIT_SCRIPT_ID = "tb-ski-wallet-kit-script";
const SKI_UI_SCRIPT_ID = "tb-ski-wallet-ui-script";

function injectStyle(id: string, css: string): void {
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

function injectScript(id: string, source: string): void {
  if (document.getElementById(id)) return;
  const script = document.createElement("script");
  script.id = id;
  script.type = "text/javascript";
  script.textContent = source;
  document.head.appendChild(script);
}

export async function mountSkiWalletWidget(): Promise<boolean> {
  const widgetShell = document.getElementById("wallet-widget");
  const widgetHost = document.getElementById("ski-wallet-widget-host");
  const modalHost = document.getElementById("ski-wallet-modal-host");
  if (!widgetShell || !widgetHost || !modalHost) return false;

  try {
    const [{ generateWalletKitJs }, { generateWalletUiCss, generateWalletUiJs }] = await Promise.all([
      import("../node_modules/sui.ski/src/utils/wallet-kit-js.ts"),
      import("../node_modules/sui.ski/src/utils/wallet-ui-js.ts"),
    ]);

    injectStyle(SKI_STYLE_ID, generateWalletUiCss());

    window.tbSkiWidgetConnected = () => {
      window.dispatchEvent(new CustomEvent("tb:ski-wallet-connected"));
    };
    window.tbSkiWidgetDisconnected = () => {
      window.dispatchEvent(new CustomEvent("tb:ski-wallet-disconnected"));
    };

    injectScript(
      SKI_KIT_SCRIPT_ID,
      generateWalletKitJs({
        network: "mainnet",
        autoConnect: false,
      }),
    );
    injectScript(
      SKI_UI_SCRIPT_ID,
      generateWalletUiJs({
        showPrimaryName: true,
        onConnect: "tbSkiWidgetConnected",
        onDisconnect: "tbSkiWidgetDisconnected",
        primaryProfileHost: "sui.ski",
      }),
    );

    const skiKit = window.SuiWalletKit;
    if (!skiKit) return false;

    skiKit.renderModal("ski-wallet-modal-host");
    skiKit.renderWidget("ski-wallet-widget-host");
    if (typeof skiKit.detectWallets === "function") {
      await skiKit.detectWallets().catch(() => undefined);
    }

    widgetShell.classList.add("ski-widget-native");
    document.body.classList.add("ski-widget-native");
    return true;
  } catch (error) {
    console.warn("[ski-widget] failed to mount sui.ski wallet UI:", error);
    return false;
  }
}
