#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo 'Docker is not installed. Install Docker Engine and Compose v2 first.' >&2; exit 1; }
docker compose version >/dev/null
docker info >/dev/null
if [[ -n "$(ss -H -ltn '( sport = :443 )')" ]]; then
  # Existing gateway belonging to this app is safe to retain on a rerun.
  if ! docker compose -f compose.yaml -f compose.tencent.yaml ps --status running --services | grep -qx gateway; then
    echo 'Port 443 is occupied by another service; preserving it. No nginx configuration has been changed.' >&2
    exit 2
  fi
fi
# This script preserves nginx on 80 and never changes firewall rules or removes volumes.
bash scripts/deploy.sh
docker compose -f compose.yaml -f compose.tencent.yaml up -d gateway
ready=0
for attempt in {1..18}; do
  if curl --fail --silent --max-time 8 https://49.233.175.166/api/health >/dev/null; then
    ready=1
    break
  fi
  sleep 3
done
if [[ "$ready" == 1 ]]; then
  echo 'HTTPS application health verified: https://49.233.175.166'
  echo 'Initial account file: .local/initial-account.txt (private; do not share passwords in screenshots).'
else
  echo 'Application is running locally, but HTTPS certificate/access is not yet verified.' >&2
  echo 'Allow inbound TCP 443 in the Tencent Cloud security group and inspect:' >&2
  echo 'docker compose -f compose.yaml -f compose.tencent.yaml logs --tail=60 gateway' >&2
  exit 3
fi
