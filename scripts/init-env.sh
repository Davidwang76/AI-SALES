#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -e .env ]]; then
  echo '已存在 .env，保留现有配置。'
  exit 0
fi
umask 077
mkdir -p .local
python3 - <<'PY'
from pathlib import Path
import secrets
password=secrets.token_urlsafe(24)
db_password=secrets.token_hex(24)
Path('.env').write_text('DB_PASSWORD='+db_password+'\nBOOTSTRAP_EMAIL=owner@example.com\nBOOTSTRAP_PASSWORD='+password+'\nBOOTSTRAP_ENTITY=广州经营主体\nAPP_PORT=3000\nBIND_ADDRESS=127.0.0.1\nCOOKIE_SECURE=true\nMODEL_API_KEY=\nMODEL_NAME=\n')
Path('.local/initial-account.txt').write_text('首次账号：owner@example.com\n首次密码：'+password+'\n请登录后更换，并销毁本文件。\n')
PY
chmod 600 .env .local/initial-account.txt
echo '已生成私有配置 .env 与首次账号文件 .local/initial-account.txt。不会创建演示数据。'
