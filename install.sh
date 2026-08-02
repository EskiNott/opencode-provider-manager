#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
TARGET="$ROOT/opencode-provider-manager"
STAMP="$(date +%Y%m%d-%H%M%S)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install Node.js 20 or newer and make sure 'node -v' works in this terminal."
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js 20 or newer is required. Current version: $(node -v)"
  exit 1
fi

mkdir -p "$ROOT" "$TARGET" "$TARGET/backups"

for file in manager.mjs manage.sh sync-models.sh README.md README_EN.md providers.example.json; do
  if [ -f "$TARGET/$file" ]; then
    cp "$TARGET/$file" "$TARGET/backups/$file.$STAMP.bak"
  fi
  cp "$SOURCE_DIR/$file" "$TARGET/$file"
done

if [ ! -f "$TARGET/providers.json" ]; then
  cp "$SOURCE_DIR/providers.example.json" "$TARGET/providers.json"
fi

chmod +x "$TARGET/manage.sh" "$TARGET/sync-models.sh"
node "$TARGET/manager.mjs" migrate

echo
echo "Installed to: $TARGET"
echo "Run the interactive manager:"
echo "  cd ~/.config/opencode/opencode-provider-manager"
echo "  ./manage.sh"
