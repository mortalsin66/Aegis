#!/usr/bin/env bash
set -euo pipefail
SOURCE_DIR=$(cd "$(dirname "$0")/.." && pwd)
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT
mkdir -p "$TEST_DIR/agent" "$TEST_DIR/web/dist" "$TEST_DIR/state"
tar --exclude=node_modules --exclude='.aegis-*' -C "$SOURCE_DIR" -cf - . | tar -C "$TEST_DIR/agent" -xf -
printf '<html>test</html>' > "$TEST_DIR/web/dist/index.html"
# Simulate code copied by a pre-1.1 updater, with no matching dependencies installed.
cd "$TEST_DIR/agent"
AEGIS_TEST=1 AEGIS_PASSWORD=legacy-migration-password AEGIS_STATE_DIR="$TEST_DIR/state" CI=true node src/index.js
test -s node_modules/.aegis-dependencies
node scripts/smoke.mjs
echo 'Legacy update dependency migration passed'
