import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,html}"],
  theme: {
    extend: {
      colors: {
        sui: {
          blue: "#4DA2FF",
          dark: "#0D1117",
          panel: "#161B22",
          border: "#21262D",
          text: "#C9D1D9",
          muted: "#8B949E",
          accent: "#58A6FF",
          success: "#3FB950",
          warning: "#D29922",
          error: "#F85149",
        },
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
