#!/usr/bin/env bash
# check-prereqs.sh — verify everything needed for a Play Store TWA build
set -euo pipefail

RED='\033[0;31m'; YEL='\033[1;33m'; GRN='\033[0;32m'; NC='\033[0m'
ok()   { echo -e "${GRN}✓${NC} $1"; }
warn() { echo -e "${YEL}⚠${NC}  $1"; }
fail() { echo -e "${RED}✗${NC} $1"; FAILED=1; }

FAILED=0

echo ""
echo "Thunderbun TWA — prerequisite check"
echo "────────────────────────────────────"

# ── Java 17+ ──────────────────────────────────────────────────────────────────
if command -v java &>/dev/null; then
  JAVA_VER=$(java -version 2>&1 | awk -F '"' '/version/ {print $2}' | cut -d. -f1)
  # Versions like "17", "21", "11"; old style "1.8" → strip leading "1."
  [[ "$JAVA_VER" == "1" ]] && JAVA_VER=$(java -version 2>&1 | awk -F '"' '/version/ {print $2}' | cut -d. -f2)
  if [[ "$JAVA_VER" -ge 17 ]]; then
    ok "Java $JAVA_VER"
  else
    fail "Java $JAVA_VER found — need Java 17+. Install: https://adoptium.net"
  fi
else
  fail "Java not found — install Java 17+: https://adoptium.net"
fi

# ── Bubblewrap CLI ─────────────────────────────────────────────────────────────
if command -v bubblewrap &>/dev/null; then
  BW_VER=$(bubblewrap --version 2>&1 | head -1)
  ok "bubblewrap ${BW_VER}"
else
  fail "bubblewrap not found — run: npm install -g @bubblewrap/cli"
fi

# ── twa-manifest.json ─────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

if [[ -f "$ROOT/twa-manifest.json" ]]; then
  HOST=$(python3 -c "import json,sys; d=json.load(open('$ROOT/twa-manifest.json')); print(d.get('host',''))" 2>/dev/null || true)
  if [[ "$HOST" == "YOUR_APP_DOMAIN_HERE" || -z "$HOST" ]]; then
    fail "twa-manifest.json exists but host is not set — edit twa-manifest.json"
  else
    ok "twa-manifest.json → host: $HOST"
  fi
else
  fail "twa-manifest.json missing — copy twa-manifest.json.template → twa-manifest.json and fill in your domain"
fi

# ── Wrangler (Cloudflare deploy) ──────────────────────────────────────────────
if command -v wrangler &>/dev/null; then
  WR_VER=$(wrangler --version 2>&1 | head -1)
  ok "wrangler ${WR_VER}"
else
  warn "wrangler not found — run: npm install -g wrangler  (needed for deploy)"
fi

# ── dist/ (PWA build) ─────────────────────────────────────────────────────────
if [[ -d "$ROOT/dist" ]]; then
  COUNT=$(ls "$ROOT/dist" | wc -l | tr -d ' ')
  ok "dist/ exists ($COUNT files)"
else
  warn "dist/ not built yet — run: bun run build"
fi

# ── PNG icons ─────────────────────────────────────────────────────────────────
if [[ -f "$ROOT/public/icons/pwa-192x192.png" && -f "$ROOT/public/icons/pwa-512x512.png" ]]; then
  ok "PWA icons (192×192, 512×512) present"
else
  warn "PNG icons missing — run: bun add -d sharp && bun run icons:generate"
fi

# ── Digital Asset Links ───────────────────────────────────────────────────────
if [[ -f "$ROOT/public/.well-known/assetlinks.json" ]]; then
  FINGERPRINT=$(python3 -c "import json,sys; d=json.load(open('$ROOT/public/.well-known/assetlinks.json')); print(d[0]['target']['sha256_cert_fingerprints'][0][:8])" 2>/dev/null || echo "?")
  if [[ "$FINGERPRINT" == "REPLACE_W" || "$FINGERPRINT" == "?" ]]; then
    warn "assetlinks.json exists but fingerprint is placeholder — run: bun run twa:assetlinks"
  else
    ok "assetlinks.json fingerprint: ${FINGERPRINT}…"
  fi
else
  warn "assetlinks.json not yet generated — run: bun run twa:assetlinks (after twa:build)"
fi

echo ""
if [[ "$FAILED" -eq 0 ]]; then
  echo -e "${GRN}All required prerequisites satisfied.${NC}"
  echo "Next: bun run twa:build"
else
  echo -e "${RED}Some prerequisites are missing — fix the items above before building.${NC}"
  exit 1
fi
echo ""
