import ThunderBun, { Electroview } from "thunderbun/view";

const rpc = Electroview.defineRPC<any>({
  maxRequestTime: 120000,
  handlers: {
    requests: {},
    messages: {
      updatePosition: ({ x, y }: { x: number; y: number }) => {
        const el = document.getElementById("position");
        if (el) el.textContent = `${x}, ${y}`;
      },
      updateSize: ({ width, height }: { width: number; height: number }) => {
        const el = document.getElementById("size");
        if (el) el.textContent = `${width} x ${height}`;
      },
      updateStatus: ({ moveDetected, resizeDetected }: { moveDetected: boolean; resizeDetected: boolean }) => {
        if (moveDetected) {
          document.getElementById("move-indicator")?.classList.add("detected");
          const moveStatus = document.getElementById("move-status");
          if (moveStatus) {
            moveStatus.classList.add("detected");
            moveStatus.textContent = "Move: Detected!";
          }
        }
        if (resizeDetected) {
          document.getElementById("resize-indicator")?.classList.add("detected");
          const resizeStatus = document.getElementById("resize-status");
          if (resizeStatus) {
            resizeStatus.classList.add("detected");
            resizeStatus.textContent = "Resize: Detected!";
          }
        }
        if (moveDetected && resizeDetected) {
          document.getElementById("done-message")?.classList.add("show");
        }
      },
    },
  },
});

const thunderbun = new ThunderBun.Electroview({ rpc });

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("closeBtn")?.addEventListener("click", () => {
    (thunderbun.rpc as any)?.request.closeWindow({});
  });
});
