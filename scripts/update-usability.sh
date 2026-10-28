#!/usr/bin/env bash
set -euo pipefail
release_dir=$(cd "$(dirname "$0")/.." && pwd)
app_dir=${1:-/home/ubuntu/ai-sales-9f45fcd}
cd "$app_dir"
[[ -f .env && -f compose.yaml && -f compose.tencent.yaml ]] || { echo '未找到原安装目录和配置，停止更新。'; exit 1; }
files=(apps/web/src/main.tsx apps/web/src/style.css apps/web/src/Navigation.tsx apps/web/src/CollectionForm.tsx deploy/Caddyfile.tencent docs/usability-update.md)
for file in "${files[@]}"; do [[ -f "$release_dir/$file" ]] || { echo "缺少更新文件：$file"; exit 1; }; done
backup_dir=".local/ui-update-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
for file in "${files[@]}"; do
  if [[ -f "$file" ]]; then mkdir -p "$backup_dir/$(dirname "$file")"; cp -p "$file" "$backup_dir/$file"; fi
  mkdir -p "$(dirname "$file")"
  cp "$release_dir/$file" "$file"
done
echo "源码备份：$app_dir/$backup_dir"
echo '正在构建界面更新，现有服务继续运行。'
docker compose build migrate
docker compose -f compose.yaml -f compose.tencent.yaml exec -T gateway caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose up -d --no-deps web worker
docker compose -f compose.yaml -f compose.tencent.yaml exec -T gateway caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 8 https://49.233.175.166/api/health; then
    echo
    echo '更新完成，HTTPS健康检查通过。请在浏览器按 Ctrl+F5 刷新。账号与业务数据保留。'
    exit 0
  fi
  sleep 2
done
echo '服务已更新，但HTTPS健康检查未通过。请保留输出，勿重复初始化或删除数据卷。'
docker compose -f compose.yaml -f compose.tencent.yaml ps
exit 1
