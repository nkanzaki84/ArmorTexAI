#!/usr/bin/env bash
# Promote HEAD to the team's /exec URL. Every run burns one of the script's
# 200 lifetime versions, so use `clasp push -f` + the /dev URL for daily work
# and run this only when a batch is ready for Tanner.
#
# Usage: ./deploy.sh "v1.0.1 - what changed"
set -euo pipefail
cd "$(dirname "$0")"
DESC="${1:-$(git log -1 --pretty=%s 2>/dev/null || echo deploy)}"

echo "== clasp push"; clasp push -f
DEPLOYMENT_ID=$(clasp deployments | grep -E '^- [A-Za-z0-9_-]+ @[0-9]+' | head -n 1 | awk '{print $2}')
if [ -z "$DEPLOYMENT_ID" ]; then
  echo "== first deployment"; clasp deploy -d "$DESC"
else
  echo "== updating $DEPLOYMENT_ID"; clasp deploy -i "$DEPLOYMENT_ID" -d "$DESC"
fi
clasp deployments
