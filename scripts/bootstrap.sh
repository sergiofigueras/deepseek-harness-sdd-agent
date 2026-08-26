#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dsh_home="$project_root/.dsh-home"
settings_target="$dsh_home/settings.yaml"
settings_source="$project_root/config/settings.yaml"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (22.19+ or 24+)." >&2
  exit 1
fi

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
node_minor="$(node -p 'Number(process.versions.node.split(".")[1])')"
if (( node_major < 22 )) || (( node_major == 22 && node_minor < 19 )); then
  echo "Node.js 22.19+ is required; found $(node --version)." >&2
  exit 1
fi

mkdir -p "$dsh_home"
if [[ -e "$settings_target" ]]; then
  echo "Keeping existing $settings_target"
  echo "Compare it with $settings_source before upgrading model routes."
else
  cp "$settings_source" "$settings_target"
  echo "Created $settings_target"
fi

if [[ ! -e "$project_root/.env" ]]; then
  cp "$project_root/.env.example" "$project_root/.env"
  echo "Created .env. Replace OPENAI_API_KEY=replace-me before launch."
fi

echo "Bootstrap complete. Run ./scripts/launch.sh from the project root."
