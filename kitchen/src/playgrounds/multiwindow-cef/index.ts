import { Electroview } from "thunderbun/view";

const rpc = Electroview.defineRPC<any>({
  maxRequestTime: 600000,
  handlers: {
    requests: {},
    messages: {
      setWindowId: ({ id }: { id: number }) => {
        const el = document.getElementById("windowId");
        if (el) el.textContent = String(id);
      },
    },
  },
});

const thunderbun = new Electroview({ rpc });

document.addEventListener("DOMContentLoaded", () => {
  // Mark window as created
  const windowStatus = document.getElementById("windowStatus");
  if (windowStatus) {
    windowStatus.classList.add("success");
  }

  // Mark OOPIF as pending while loading
  const oopifStatus = document.getElementById("oopifStatus");
  if (oopifStatus) {
    oopifStatus.classList.add("pending");
  }

  // Listen for webview load using thunderbun-webview's .on() method
  const webview = document.querySelector("thunderbun-webview") as any;
  if (webview) {
    webview.on("dom-ready", () => {
      if (oopifStatus) {
        oopifStatus.classList.remove("pending");
        oopifStatus.classList.add("success");
      }
      // Notify bun that this window's OOPIF loaded
      (thunderbun.rpc as any)?.send.oopifLoaded({});
    });
  }
});
