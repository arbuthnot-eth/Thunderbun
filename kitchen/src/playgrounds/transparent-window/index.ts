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
  // Close button
  document.getElementById("closeBtn")?.addEventListener("click", () => {
    (thunderbun.rpc as any)?.request.closeWindow({});
  });

  // Make the floating cards draggable
  const cards = document.querySelectorAll(".floating-card");
  cards.forEach((card) => {
    card.classList.add("thunderbun-webkit-app-region-drag");
  });
});
