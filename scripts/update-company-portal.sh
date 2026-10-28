#!/usr/bin/env bash
set -euo pipefail
umask 077
release_dir=$(cd "$(dirname "$0")/.." && pwd)
app_dir=${1:-/home/ubuntu/ai-sales-9f45fcd}
cd "$app_dir"
[[ -f .env && -f compose.yaml && -f compose.tencent.yaml ]] || { echo '未找到原安装目录，停止更新。'; exit 1; }
files=(apps/api/context.ts apps/api/server.ts apps/api/operations.ts apps/web/src/main.tsx apps/web/src/style.css apps/web/src/CollectionForm.tsx apps/web/src/Navigation.tsx apps/web/src/CompanyPortal.tsx apps/web/src/CompanyWorkspace.tsx packages/db/migrations/006_company_portal.sql packages/db/provision-portals.ts deploy/Caddyfile.tencent docs/company-portal.md)
for file in "${files[@]}"; do [[ -f "$release_dir/$file" ]] || { echo "缺少更新文件：$file"; exit 1; }; done
backup_dir=".local/company-portal-update-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
bash scripts/backup.sh
for file in "${files[@]}"; do
  if [[ -f "$file" ]]; then mkdir -p "$backup_dir/$(dirname "$file")"; cp -p "$file" "$backup_dir/$file"; fi
  mkdir -p "$(dirname "$file")"
  cp "$release_dir/$file" "$file"
done
echo "源码备份：$app_dir/$backup_dir"
docker compose build migrate
docker compose run --rm -T migrate npm run db:migrate
accounts_file="$backup_dir/company-initial-accounts.txt"
docker compose run --rm -T migrate node --import tsx packages/db/provision-portals.ts > "$accounts_file"
chmod 600 "$accounts_file"
docker compose -f compose.yaml -f compose.tencent.yaml exec -T gateway caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose up -d --no-deps web worker
docker compose -f compose.yaml -f compose.tencent.yaml exec -T gateway caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 8 https://49.233.175.166/api/health; then
    echo
    echo '更新完成，HTTPS健康检查通过。浏览器打开网址首页并按 Ctrl+F5 刷新。'
    echo '01入口沿用原管理员邮箱和密码。02—09入口各有独立的初始管理员。'
    echo "新账号仅保存在服务器私有文件：$app_dir/$accounts_file"
    echo '请自行查看并妥善保管，不要发到聊天或公开仓库。'
    exit 0
  fi
  sleep 2
done
echo 'HTTPS健康检查尚未通过，请保留输出，勿重新初始化或删除数据卷。'
docker compose -f compose.yaml -f compose.tencent.yaml ps
exit 1
