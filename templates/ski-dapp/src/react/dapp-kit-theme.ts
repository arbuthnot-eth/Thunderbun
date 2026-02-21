import type { ThemeVars } from "@mysten/dapp-kit";

// Brand-aligned dApp Kit theme for all Mysten wallet UI primitives.
export const thunderbunDappKitTheme: ThemeVars = {
  blurs: {
    modalOverlay: "blur(10px)",
  },
  backgroundColors: {
    primaryButton: "#ffb800",
    primaryButtonHover: "#f3ad00",
    outlineButtonHover: "#17263a",
    modalOverlay: "rgba(2, 8, 20, 0.72)",
    modalPrimary: "#0f1d2e",
    modalSecondary: "#0a1523",
    iconButton: "transparent",
    iconButtonHover: "#17263a",
    dropdownMenu: "#0f1d2e",
    dropdownMenuSeparator: "rgba(48, 94, 146, 0.35)",
    walletItemSelected: "#132740",
    walletItemHover: "#1a314d",
  },
  borderColors: {
    outlineButton: "rgba(48, 94, 146, 0.6)",
  },
  colors: {
    primaryButton: "#0b1624",
    outlineButton: "#d7e6ff",
    iconButton: "#d7e6ff",
    body: "#e6eefb",
    bodyMuted: "#8ca6c8",
    bodyDanger: "#ff7b7b",
  },
  radii: {
    small: "8px",
    medium: "12px",
    large: "16px",
    xlarge: "20px",
  },
  shadows: {
    primaryButton: "0px 10px 24px rgba(255, 184, 0, 0.28)",
    walletItemSelected: "0px 8px 22px rgba(8, 20, 36, 0.45)",
  },
  fontWeights: {
    normal: "400",
    medium: "500",
    bold: "700",
  },
  fontSizes: {
    small: "14px",
    medium: "16px",
    large: "18px",
    xlarge: "20px",
  },
  typography: {
    fontFamily: "\"Space Grotesk\", ui-sans-serif, system-ui, -apple-system, sans-serif",
    fontStyle: "normal",
    lineHeight: "1.35",
    letterSpacing: "0.01em",
  },
};
