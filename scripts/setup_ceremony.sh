#!/usr/bin/env bash
#
# Compiles a Payfurt circuit over BLS12-381 and runs a dev Groth16 trusted setup.
#
#   Usage: scripts/setup_ceremony.sh [circuit]   # default: payroll
#
# Outputs, in circuits/build/:
#   <circuit>.r1cs  <circuit>_js/<circuit>.wasm  <circuit>.zkey  <circuit>_vk.json
# and copies the browser artifacts to client/public/circuits/.
#
# NOTE: this is a DEV ceremony (single local contribution). Do not use the
# resulting zkey in production — run a real multi-party ceremony for mainnet.
set -euo pipefail

CIRCUIT="${1:-payroll}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUITS="$ROOT/circuits"
BUILD="$CIRCUITS/build"
PTAU="$BUILD/pot_bls12381_final.ptau"

export PATH="$HOME/.cargo/bin:$PATH"   # circom installed via `cargo install`

command -v circom >/dev/null || { echo "circom not found (cargo install --path /tmp/circom/circom)"; exit 1; }
[ -d "$CIRCUITS/node_modules/circomlib" ] || { echo "circomlib missing: (cd circuits && pnpm add -D circomlib snarkjs)"; exit 1; }

mkdir -p "$BUILD"
cd "$CIRCUITS"

echo "▶ compiling $CIRCUIT.circom over BLS12-381"
circom "$CIRCUIT.circom" --r1cs --wasm --sym --prime bls12381 -l node_modules -o "$BUILD"

# Powers of Tau over BLS12-381 (the hermez .ptau files are BN254 — unusable here).
# 2^15 comfortably covers payroll (~3.5k constraints incl. Poseidon).
if [ ! -f "$PTAU" ]; then
  echo "▶ generating BLS12-381 powers of tau (one-time, ~minutes)"
  npx snarkjs powersoftau new bls12-381 15 "$BUILD/pot_0.ptau" -v
  echo "payfurt-dev-entropy-$(date +%s)" | npx snarkjs powersoftau contribute "$BUILD/pot_0.ptau" "$BUILD/pot_1.ptau" --name="dev" -v
  npx snarkjs powersoftau prepare phase2 "$BUILD/pot_1.ptau" "$PTAU" -v
fi

echo "▶ groth16 setup + dev contribution"
npx snarkjs groth16 setup "$BUILD/$CIRCUIT.r1cs" "$PTAU" "$BUILD/${CIRCUIT}_0.zkey"
echo "payfurt-dev-zkey-$(date +%s)" | npx snarkjs zkey contribute "$BUILD/${CIRCUIT}_0.zkey" "$BUILD/$CIRCUIT.zkey" --name="dev" -v
npx snarkjs zkey export verificationkey "$BUILD/$CIRCUIT.zkey" "$BUILD/${CIRCUIT}_vk.json"

DEST="$ROOT/client/public/circuits"
mkdir -p "$DEST"
cp "$BUILD/${CIRCUIT}_js/$CIRCUIT.wasm" "$DEST/$CIRCUIT.wasm"
cp "$BUILD/$CIRCUIT.zkey" "$DEST/$CIRCUIT.zkey"
cp "$BUILD/${CIRCUIT}_vk.json" "$DEST/${CIRCUIT}_vk.json"

echo "✅ $CIRCUIT ceremony done → build artifacts in $BUILD, browser artifacts in $DEST"
