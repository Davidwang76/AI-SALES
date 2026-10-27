#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
backup_dir="${BACKUP_DIR:-.local/backups}/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
# 短暂停止本项目写入进程，取得数据库与附件的一致备份。
restore_processes(){ docker compose start web worker >/dev/null; }
docker compose stop web worker >/dev/null
trap restore_processes EXIT
docker compose exec -T db pg_dump -U sales -d sales -Fc > "$backup_dir/database.dump"
docker compose run --rm --no-deps --user root -T web tar -C /app/data -cf - files > "$backup_dir/files.tar"
sha256sum "$backup_dir/database.dump" "$backup_dir/files.tar" > "$backup_dir/SHA256SUMS"
echo "备份完成：$backup_dir（数据库与附件；配置需单独安全备份）。"
