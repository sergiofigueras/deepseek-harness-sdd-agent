#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -z "${OPENAI_API_KEY:-}" || "${OPENAI_API_KEY}" == "replace-me" ]]; then
  echo "Set OPENAI_API_KEY in .env or in the environment before launching." >&2
  exit 1
fi

export DSH_HOME="$project_root/.dsh-home"

if [[ ! -f "$DSH_HOME/settings.yaml" ]]; then
  echo "Missing $DSH_HOME/settings.yaml. Run ./scripts/bootstrap.sh first." >&2
  exit 1
fi

exec npx --yes @deepseek-ai/dsh@0.1.1-rc.2 web "$@"
