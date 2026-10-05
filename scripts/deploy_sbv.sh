#!/usr/bin/env bash
#
# Builds and deploys salary_bracket_verifier to a Stellar network, then
# initializes it with vk_bracket + the payroll_verifier address.
#
#   Usage: bash scripts/deploy_sbv.sh [network] [identity]
#          network  default: testnet   identity default: $STELLAR_IDENTITY or "maylord"
#
# Prerequisites:
#   - payroll_verifier already deployed (deployments/<network>.json must exist)
#   - salary_bracket ceremony run (circuits/build/salary_bracket_vk.json must exist)
set -euo pipefail

NETWORK="${1:-testnet}"
IDENTITY="${2:-${STELLAR_IDENTITY:-maylord}}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM="$ROOT/target/wasm32v1-none/release/salary_bracket_verifier.wasm"
DEPLOY_FILE="$ROOT/deployments/$NETWORK.json"
VK_FILE="$ROOT/circuits/build/salary_bracket_vk.json"

[ -f "$DEPLOY_FILE" ] || { echo "❌ $DEPLOY_FILE not found — run deploy.sh first"; exit 1; }
[ -f "$VK_FILE" ]     || { echo "❌ $VK_FILE not found — run: bash scripts/setup_ceremony.sh salary_bracket"; exit 1; }

PAYROLL_ID=$(python3 -c "import json; print(json.load(open('$DEPLOY_FILE'))['payroll_verifier'])")
echo "payroll_verifier : $PAYROLL_ID"
echo "network          : $NETWORK"
echo "identity         : $IDENTITY"

echo ""
echo "▶ building salary_bracket_verifier"
stellar contract build \
  --manifest-path "$ROOT/contracts/salary_bracket_verifier/Cargo.toml" \
  --optimize
OPT_WASM="${WASM%.wasm}.optimized.wasm"
[ -f "$OPT_WASM" ] || OPT_WASM="$WASM"

echo ""
echo "▶ deploying to $NETWORK as $IDENTITY"
SBV_ID=$(stellar contract deploy \
  --wasm "$OPT_WASM" \
  --source "$IDENTITY" \
  --network "$NETWORK")
echo "✅ deployed salary_bracket_verifier: $SBV_ID"

echo ""
echo "▶ initializing with vk_bracket + payroll_verifier address"
pnpm --silent exec tsx "$ROOT/scripts/init_sbv.ts" \
  "$SBV_ID" "$PAYROLL_ID" "$IDENTITY" "$NETWORK"

echo ""
echo "▶ writing to $DEPLOY_FILE"
python3 - <<PYEOF
import json
with open('$DEPLOY_FILE') as f:
    d = json.load(f)
d['salary_bracket_verifier'] = '$SBV_ID'
with open('$DEPLOY_FILE', 'w') as f:
    json.dump(d, f, indent=2)
    f.write('\n')
PYEOF

echo "✅ deployments/$NETWORK.json updated"
echo ""
echo "Next: generate bindings"
echo "  SBV_ID=\$(python3 -c \"import json; print(json.load(open('deployments/$NETWORK.json'))['salary_bracket_verifier'])\")"
echo "  stellar contract bindings typescript \\"
echo "    --contract-id \"\$SBV_ID\" --network $NETWORK \\"
echo "    --output-dir client/lib/bindings/salary_bracket_verifier --overwrite"
