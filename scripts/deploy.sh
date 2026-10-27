#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null
docker compose version >/dev/null
bash scripts/init-env.sh
# 本脚本不停止无关服务、不修改防火墙、不删除数据卷。
docker compose build migrate
docker compose up -d db migrate
# 初始化正式空账号，不带 --demo；已存在账号不会重设。
docker compose run --rm migrate npm run db:seed
app_port="$(python3 -c 'from pathlib import Path; print(dict(l.split("=",1) for l in Path(".env").read_text().splitlines() if "=" in l).get("APP_PORT","3000"))')"
docker compose up -d web worker
for attempt in {1..30}; do
  if curl --fail --silent "http://127.0.0.1:${app_port}/api/health" >/dev/null; then
    echo '应用及数据库健康检查通过。需按 docs/deployment.md 完成 HTTPS 入口再正式使用。'
    exit 0
  fi
  sleep 2
done
echo '启动尚未通过健康检查，请运行 docker compose logs --tail=80 web worker。' >&2
exit 1
