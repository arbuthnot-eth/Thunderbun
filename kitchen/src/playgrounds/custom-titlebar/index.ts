import ThunderBun, { Thunderview } from "thunderbun/view";

const rpc = Thunderview.defineRPC<any>({
  maxRequestTime: 600000,
  handlers: {
    requests: {},
    messages: {},
  },
});

const thunderbun = new ThunderBun.Thunderview({ rpc });

document.addEventListener("DOMContentLoaded", () => {
  // Custom window control buttons
  document.getElementById("closeBtn")?.addEventListener("click", () => {
    (thunderbun.rpc as any)?.request.closeWindow({});
  });

  document.getElementById("minimizeBtn")?.addEventListener("click", () => {
    (thunderbun.rpc as any)?.request.minimizeWindow({});
  });

  document.getElementById("maximizeBtn")?.addEventListener("click", () => {
    (thunderbun.rpc as any)?.request.maximizeWindow({});
  });

  // Done button
  document.getElementById("doneBtn")?.addEventListener("click", () => {
    (thunderbun.rpc as any)?.request.closeWindow({});
  });
});
