#!/usr/bin/env bash
# git pull + firebase deploy.  Usage: ./deploy.sh ["what changed"]
set -euo pipefail
cd "$(dirname "$0")"
MSG="${1:-$(git log -1 --pretty=%s 2>/dev/null || echo deploy)}"
echo "== git pull";       git pull
echo "== firebase deploy"; firebase deploy -m "$MSG"
