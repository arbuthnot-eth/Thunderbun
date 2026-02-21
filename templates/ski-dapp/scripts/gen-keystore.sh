#!/usr/bin/env bash
# gen-keystore.sh — generate a signing keystore and print the SHA256 fingerprint
#
# TWA Release Signing Guide:
#   Internal Testing → debug keystore is fine (no review required).
#   Production       → generate a new keystore, keep it SECRET, never commit it.
#
# Usage:
#   bash scripts/gen-keystore.sh              # interactive (prompts for alias/password)
#   bash scripts/gen-keystore.sh debug        # non-interactive debug keystore
#   bash scripts/gen-keystore.sh release      # prompts for secure release keystore
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
MODE="${1:-interactive}"

RED='\033[0;31m'; YEL='\033[1;33m'; GRN='\033[0;32m'; CYA='\033[0;36m'; NC='\033[0m'

if ! command -v keytool &>/dev/null; then
  echo -e "${RED}keytool not found — install Java 17+: https://adoptium.net${NC}"
  exit 1
fi

echo ""
echo "Thunderbun TWA — keystore generator"
echo "────────────────────────────────────"

if [[ "$MODE" == "debug" ]]; then
  KEYSTORE="$ROOT/android-debug.keystore"
  ALIAS="androiddebugkey"
  STOREPASS="android"
  KEYPASS="android"
  DNAME="CN=Android Debug,O=Android,C=US"

  echo -e "${YEL}Generating DEBUG keystore (for internal testing only)...${NC}"
  keytool -genkey -v \
    -keystore "$KEYSTORE" \
    -alias "$ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$STOREPASS" -keypass "$KEYPASS" \
    -dname "$DNAME" 2>&1 | grep -v "^Warning"

  echo -e "${GRN}Debug keystore written to: android-debug.keystore${NC}"
  echo -e "${YEL}⚠  Do NOT use this for production — it has a well-known password.${NC}"

elif [[ "$MODE" == "release" ]]; then
  KEYSTORE="$ROOT/android-release.keystore"

  echo -e "${YEL}Generating RELEASE keystore (keep this file SECRET — never commit it!)${NC}"
  echo ""
  read -rp "Key alias (e.g. thunderbun-key): " ALIAS
  read -rsp "Store password: " STOREPASS; echo
  read -rsp "Key password (can be same as store): " KEYPASS; echo
  read -rp "Your name (CN, for cert): " CN
  read -rp "Organization (O): " ORG
  read -rp "Country code (C, e.g. US): " COUNTRY

  keytool -genkey -v \
    -keystore "$KEYSTORE" \
    -alias "$ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$STOREPASS" -keypass "$KEYPASS" \
    -dname "CN=$CN,O=$ORG,C=$COUNTRY"

  echo -e "${GRN}Release keystore written to: android-release.keystore${NC}"
  echo -e "${RED}IMPORTANT: Back this file up securely. Losing it = losing your Play Store listing.${NC}"
  STOREPASS_HINT="$STOREPASS"
else
  # Interactive — let keytool prompt for everything
  KEYSTORE="$ROOT/android-release.keystore"
  echo "Generating release keystore interactively..."
  keytool -genkey -v \
    -keystore "$KEYSTORE" \
    -keyalg RSA -keysize 2048 -validity 10000
  STOREPASS_HINT=""
fi

# ── Print SHA256 fingerprint ──────────────────────────────────────────────────
echo ""
echo "SHA256 fingerprint (needed for assetlinks.json):"
echo "─────────────────────────────────────────────────"

if [[ "$MODE" == "debug" ]]; then
  FINGERPRINT=$(keytool -list -v -keystore "$KEYSTORE" \
    -alias "$ALIAS" -storepass "$STOREPASS" 2>/dev/null \
    | grep "SHA256:" | awk '{print $2}')
elif [[ "$MODE" == "release" ]]; then
  FINGERPRINT=$(keytool -list -v -keystore "$KEYSTORE" \
    -alias "$ALIAS" -storepass "$STOREPASS_HINT" 2>/dev/null \
    | grep "SHA256:" | awk '{print $2}')
else
  FINGERPRINT=$(keytool -list -v -keystore "$KEYSTORE" 2>/dev/null \
    | grep "SHA256:" | awk '{print $2}')
fi

echo -e "${CYA}${FINGERPRINT}${NC}"
echo ""

# ── Write assetlinks.json ─────────────────────────────────────────────────────
ASSETLINKS="$ROOT/public/.well-known/assetlinks.json"
mkdir -p "$ROOT/public/.well-known"

# Read package ID from twa-manifest.json if available
PKG_ID="com.thunderbun.app"
if [[ -f "$ROOT/twa-manifest.json" ]]; then
  PKG_ID=$(python3 -c "import json; d=json.load(open('$ROOT/twa-manifest.json')); print(d.get('packageId','com.thunderbun.app'))" 2>/dev/null || echo "com.thunderbun.app")
fi

cat > "$ASSETLINKS" <<EOF
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "$PKG_ID",
    "sha256_cert_fingerprints": ["$FINGERPRINT"]
  }
}]
EOF

echo -e "${GRN}Written: public/.well-known/assetlinks.json${NC}"
echo ""
echo "Next steps:"
echo "  1. Deploy your app (bun run build && npx vercel dist --prod)"
echo "  2. The assetlinks.json file is already in public/.well-known/ and will"
echo "     be served automatically at https://your-domain/.well-known/assetlinks.json"
echo "  3. Update twa-manifest.json with your domain, then: bun run twa:build"
echo ""
