#!/usr/bin/env bash
#
# Builds, optimizes, and deploys payroll_verifier to a Stellar network, then writes
# the contract id to deployments/<network>.json. `initialize` (which needs the
# structured verification key) is done by scripts/e2e.ts.
#
#   Usage: scripts/deploy.sh [network] [source_identity]
#          network default: testnet   identity default: $STELLAR_IDENTITY or "maylord"
set -euo pipefail

NETWORK="${1:-testnet}"
IDENTITY="${2:-${STELLAR_IDENTITY:-maylord}}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM="$ROOT/target/wasm32v1-none/release/payroll_verifier.wasm"
OUT_DIR="$ROOT/deployments"
OUT="$OUT_DIR/$NETWORK.json"

echo "▶ building + optimizing"
stellar contract build --manifest-path "$ROOT/contracts/payroll_verifier/Cargo.toml" --optimize
OPT_WASM="${WASM%.wasm}.optimized.wasm"
[ -f "$OPT_WASM" ] || OPT_WASM="$WASM"

echo "▶ deploying to $NETWORK as $IDENTITY"
CONTRACT_ID=$(stellar contract deploy \
  --wasm "$OPT_WASM" \
  --source "$IDENTITY" \
  --network "$NETWORK")

mkdir -p "$OUT_DIR"
cat > "$OUT" <<JSON
{
  "network": "$NETWORK",
  "identity": "$IDENTITY",
  "payroll_verifier": "$CONTRACT_ID",
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

echo "✅ deployed payroll_verifier: $CONTRACT_ID"
echo "   wrote $OUT"
echo "   next: pnpm --dir client tsx ../scripts/e2e.ts   # initializes + runs a real payroll"
