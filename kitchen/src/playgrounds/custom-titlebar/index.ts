import ThunderBun, { Electroview } from "thunderbun/view";

const rpc = Electroview.defineRPC<any>({
  maxRequestTime: 600000,
  handlers: {
    requests: {},
    messages: {},
  },
});

const thunderbun = new ThunderBun.Electroview({ rpc });

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
