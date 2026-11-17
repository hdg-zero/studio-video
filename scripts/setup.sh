#!/usr/bin/env bash
# Installs everything the studio needs, from the repository root. Safe to run again.
#   npm run setup        (or: bash scripts/setup.sh)
set -euo pipefail
cd "$(dirname "$0")/.."

need() { command -v "$1" >/dev/null || { echo "✗ $1 introuvable. Arch : sudo pacman -S --needed $2" >&2; exit 1; }; }
need node nodejs
need npm npm
need ffmpeg ffmpeg
need python3 python

echo "▸ dépendances Node"
npm install --no-audit --no-fund --legacy-peer-deps   # see .npmrc

echo "▸ Chromium pour Playwright"
if [ -n "${CHROME_PATH:-}" ]; then
  echo "  CHROME_PATH=$CHROME_PATH : navigateur système utilisé"
else
  npx playwright install chromium
fi

echo "▸ environnement Python (.venv)"
if command -v uv >/dev/null; then
  uv venv -q --allow-existing .venv
  uv pip install -q --python .venv/bin/python -e "packages/audio[dev]"
else
  python3 -m venv .venv
  .venv/bin/pip install -q -e "packages/audio[dev]"
fi

echo "▸ compilation de la CLI"
npm run build
node bin/studio.mjs schema >/dev/null

echo "▸ diagnostic"
node bin/studio.mjs doctor || true
cat <<'MSG'

Prêt. Pour lancer `studio` de n'importe où :
  npm link            (ou ajoutez $(pwd)/bin à votre PATH)
MSG
