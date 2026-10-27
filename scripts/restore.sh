#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backup_dir="${1:?指定经过核验的备份目录}"
# 拒绝覆盖现有库；恢复只允许全新、隔离的数据库。
restore_database="${RESTORE_DATABASE:?设置一个新建的隔离数据库名，如 sales_restore_20261028}"
[[ "$restore_database" =~ ^sales_restore_[a-zA-Z0-9_]+$ ]] || { echo '恢复库名必须以 sales_restore_ 开头' >&2; exit 1; }
sha256sum --check "$backup_dir/SHA256SUMS"
docker compose exec -T db createdb -U sales "$restore_database"
docker compose exec -T db pg_restore -U sales -d "$restore_database" --no-owner --exit-on-error < "$backup_dir/database.dump"
echo "数据库已恢复到隔离库 $restore_database；附件包保留在备份目录。切换正式服务前按运行手册核验关联及附件。"
