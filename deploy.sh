#!/usr/bin/env bash
# git pull + clasp push + clasp deploy, reusing the saved deployment id.
# Usage: ./deploy.sh "what changed"
set -euo pipefail
cd "$(dirname "$0")"

DESC="${1:-$(git log -1 --pretty=%s 2>/dev/null || echo "deploy")}"

if [ ! -f .clasp.json ]; then
  echo "No .clasp.json. See docs/BUILD_AND_DEPLOY.md section 2." >&2
  exit 1
fi

echo "== git pull"
git pull

echo "== clasp push"
clasp push -f

echo "== clasp deploy"
if [ -f .deployment-id ]; then
  clasp create-deployment -i "$(cat .deployment-id)" -d "$DESC"
else
  echo "No .deployment-id yet; creating a new deployment."
  echo "Copy the AKfycb... id below into .deployment-id so future deploys reuse it."
  clasp create-deployment -d "$DESC"
fi

echo "== deployments"
clasp list-deployments
