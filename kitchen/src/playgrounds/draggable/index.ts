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
  document.getElementById("doneBtn")?.addEventListener("click", () => {
    (thunderbun.rpc as any)?.request.closeWindow({});
  });
});
