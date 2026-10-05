#!/usr/bin/env bash
#
# Adds USDC and EURC to the payroll_verifier token allowlist.
# Must be run after deploy.sh (contract must exist + be initialized).
#
#   Usage: bash scripts/add_tokens.sh [network] [identity]
#          network  default: testnet   identity default: $STELLAR_IDENTITY or "maylord"
#
# Known testnet SAC addresses (deterministic from asset code + issuer):
#   XLM  (native):  CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
#   USDC:           CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
#                   issuer: GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
#
# Mainnet SAC addresses (use after mainnet deploy):
#   XLM:    CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
#   USDC:   stellar contract id asset --asset "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" --network mainnet
#   EURC:   stellar contract id asset --asset "EURC:GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP" --network mainnet
#
# EURC on testnet: Circle does not publish an official testnet issuer.
# Options:
#   a) Provide your own EURC_ISSUER env var pointing to a testnet account you control
#   b) Skip EURC on testnet and only add it at mainnet deploy time
#   c) Use a custom test token: stellar contract deploy --wasm <token.wasm> ...
set -euo pipefail

NETWORK="${1:-testnet}"
IDENTITY="${2:-${STELLAR_IDENTITY:-maylord}}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_FILE="$ROOT/deployments/$NETWORK.json"

[ -f "$DEPLOY_FILE" ] || { echo "❌ $DEPLOY_FILE not found — run deploy.sh first"; exit 1; }
CONTRACT_ID=$(python3 -c "import sys,json; print(json.load(open('$DEPLOY_FILE'))['payroll_verifier'])")
echo "contract : $CONTRACT_ID"
echo "network  : $NETWORK"
echo "identity : $IDENTITY"

# ── helper ─────────────────────────────────────────────────────────────────────
add_token() {
  local name="$1" sac="$2"
  echo ""
  echo "▶ add_token $name ($sac)"
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- add_token \
    --token "$sac" 2>&1 | grep -v "^ℹ️" | grep -v "^🔗" || true
  echo "  ✅ $name added"
}

# ── USDC ───────────────────────────────────────────────────────────────────────
if [ "$NETWORK" = "testnet" ]; then
  USDC_ISSUER="GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
  USDC_SAC="CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"
else
  USDC_ISSUER="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
  USDC_SAC=$(stellar contract id asset --asset "USDC:$USDC_ISSUER" --network "$NETWORK")
fi
add_token "USDC" "$USDC_SAC"

# ── EURC ───────────────────────────────────────────────────────────────────────
if [ "$NETWORK" = "mainnet" ]; then
  EURC_ISSUER="GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP"
  EURC_SAC=$(stellar contract id asset --asset "EURC:$EURC_ISSUER" --network "$NETWORK")
  add_token "EURC" "$EURC_SAC"
elif [ -n "${EURC_ISSUER:-}" ]; then
  EURC_SAC=$(stellar contract id asset --asset "EURC:$EURC_ISSUER" --network "$NETWORK")
  add_token "EURC" "$EURC_SAC"
else
  echo ""
  echo "⚠️  EURC skipped on testnet (no official Circle testnet issuer)."
  echo "   To add EURC on testnet, set: EURC_ISSUER=G... bash scripts/add_tokens.sh"
  echo "   On mainnet this runs automatically."
fi

# ── write SAC addresses into deployments file ──────────────────────────────────
XLM_SAC=$(stellar contract id asset --asset native --network "$NETWORK")

python3 - <<PYEOF
import json, sys

with open('$DEPLOY_FILE') as f:
    d = json.load(f)

d['tokens'] = {
    'xlm':  '$XLM_SAC',
    'usdc': '$USDC_SAC',
}
$([ "$NETWORK" = "mainnet" ] || [ -n "${EURC_SAC:-}" ] && echo "d['tokens']['eurc'] = '${EURC_SAC:-}'")

with open('$DEPLOY_FILE', 'w') as f:
    json.dump(d, f, indent=2)
    f.write('\n')
PYEOF

echo ""
echo "✅ token allowlist updated — deployments/$NETWORK.json:"
python3 -c "import json; d=json.load(open('$DEPLOY_FILE')); print(json.dumps(d['tokens'], indent=4))"
