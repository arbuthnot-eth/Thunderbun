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
