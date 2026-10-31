#!/usr/bin/env bash
# Only updates the four portal frontend sources and the web container.
# No migrations, seeding, account initialization, volume deletion, or .env edits.
set -Eeuo pipefail
umask 077

source_commit=64363b81d080845f1909462e5d902cd35643ab59
docker_cmd=(env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock)
files=(apps/web/src/CompanyPortal.tsx apps/web/src/main.tsx apps/web/src/style.css apps/web/src/BusinessCenter.tsx)
state=""
candidate=""
switch_started=0
sources_started=0

baseline_manifest() {
  cat <<'BASELINE'
9d18385c11246aba42bf90932f57a4ef4a238695b9e251c3ae0b962d09feddb2  Dockerfile
50a5ab3dcd8d026d83a28da7be25935d8ac120080b286c771aef9867a1540875  apps/api/context.ts
693425bfd76b43f88d88b3398ccbbee7d0f0d1ff33cb1156d7c9c83958547954  apps/api/goal-collaboration.ts
b8043f4d99e1645fee8ddd79c39ec97e705ec5302dddd0e724732e9373f935fc  apps/api/goal-draft-worker.ts
4db294561d1178fea2c021473a28a582d45e3235277cb9dc335ef514905f539c  apps/api/goals.ts
c14955c8352123f3d1d0f315fc969d77d96b1a80c6da3a2fdd52445d357c5ec1  apps/api/leads.ts
6b68c27177578bff9da03ae5f6bc2c003fb7636c04f043d8d12dc9a3164100c7  apps/api/operations.ts
c7b3d5ed8adeeb2f8e71da32adb9d13069de4948a54aa7400fdba22413ef46cd  apps/api/server.ts
e2a120512d5487c5cbd26a38c4bd342fc28b9257db711fdeeec62f9e92aaa67f  apps/api/trade.ts
893a4a5d4e171ba4c614d52325c94ee8ddcf813d19aadcfc2cdfd7baaae624d9  apps/api/worker.ts
8b700277f18308dc62a750b8f7cd26b820df7424758eb4d553569c174efae5fd  apps/web/index.html
6c2af90873dbc0921f35707d0fe5d454be05cf74576d6b62d738b070c71640fe  apps/web/src/CollectionForm.tsx
4e5e879fe2834a958050980ac7aeb5376ddfdf0775dca8cd494762a4e8a4cc31  apps/web/src/CompanyPortal.tsx
bc96b9974ce496639f4d2434feafb5e614254a840fbbda99f5e2a10312685e92  apps/web/src/CompanyWorkspace.tsx
2a36771023f83d1ca498ba49f30a4129889cd4a29ab8cc7506b327c0d3d87fb6  apps/web/src/GoalCollaboration.tsx
fe66c2d3dceb39d4c57993322e0cb3f769e808d06852cb6346387ca36b18fafb  apps/web/src/GoalEntry.tsx
3679a0b4bb996039485174cd4dd82d955fc8461f6e46ce1769a6edce3578ca14  apps/web/src/GoalsWorkspace.tsx
b78ee20381721ee83d79f9f53cd9582b32e59e25a03773f1366b7892aa624683  apps/web/src/Navigation.tsx
899104e9d3cee2379698db5e05d01f8ee81814484b0c6c03ce9b9ba451a502cb  apps/web/src/PracticePortal.tsx
068927922e85b1e1b3dbb6ee33ed25ea4db27eef8238e38ea2fe1a6d2a5a093b  apps/web/src/api.ts
48fee49e67c75a7475060e510b2da1eeb0c0de97b1f0b11fffd3679e6e346ac4  apps/web/src/main.tsx
13df0934bd911bacb6a7590968d25d7d69dbbb0aa7567ed75fc9c76e6a327dea  apps/web/src/style.css
dd635f437c6bfd8e864ffce35e63f5e81bf40a62f92e1bd5b58d8d5c1ba0a4e8  apps/web/vite.config.ts
b227afd6e823a6e9d1d247d4621e864c0836598eca0dbfa6810cf264a90b8f44  compose.https.yaml
bdf56fbbf06ca58a3af5648e706fbd899fb52a3a122f88315cf3316966d3a725  compose.tencent.yaml
b230cb33676e8e595f1702105b45006b9e1cd9bccb4533d39fa80156d61db8db  compose.yaml
475430386afc863fed9cc12d9256e4eb543e144ff2b3f70f252383ec2ed0e3e3  deploy/Caddyfile
cb889d1718ca3cd39dae104c44dcc0b1a1f5db2aa27ddb32bbc6b20f11e0cc9d  deploy/Caddyfile.tencent
30b84bd5d9bf2884857a991f99f9dfcfd8b1cb07fdbb097d6862191ad6b120be  package-lock.json
96b3fcb00d98e4c25f8cfe4aaefd59c7c04c3a7426e91f017e70d4aa348ab11b  package.json
9b72094d3f7ba68fa505500852db97e987c4d3065e6eaba2d3fada6ec4f61bec  packages/adapters/goal-model.ts
fdaa8b054756bd4a6b74eb8cd2fbe3972d654e4c24d1b3f3097c979aa37c31f0  packages/adapters/model.ts
d06332f0997866d75e11081a58c886ef6ff31488b59120334781d71744c06b5c  packages/db/index.ts
ba472147d33354174890b006c59867374b51245799a449cc16a2faa6dbd5ff93  packages/db/migrate.ts
ed8601bb266e0c953e5ce6650f806f274548ead32d47c57b9e14432ff73ff7aa  packages/db/migrations/001_core.sql
ae0070b5b69bb1247a6c6f9343b226e64840b8a9c5a782ea65a9e12f869ed41f  packages/db/migrations/002_trade.sql
4b162cff3886084c88b177dcaba27ae6e8533a9354858a6daa7088e0c4dd1335  packages/db/migrations/003_constraints.sql
aa7f22e99e8e60e1ccb6d5a10bab34cab4aacc35188880916a5a2e75a567b713  packages/db/migrations/004_operations.sql
dc69fabe13fc801f21709f844b57eebd85cf22572dd67eb7c7ade154f25f91dc  packages/db/migrations/005_runtime.sql
634a5ba45162844e374132616c5ed6751d9b3f138c7266f13f0db466f64e76d7  packages/db/migrations/006_company_portal.sql
7a76849daca1d9f455ebf6454f18234b62e0a42c7bcbab61598d10282ca1083b  packages/db/migrations/007_company_names.sql
83420db7a9387bd797ed9b0587f142c0eb6009f4a8c469ee1ddd297c647ce501  packages/db/migrations/008_goals.sql
6575583e605a69ac478f682f69c49883833cf19ca83be70c298e9a1ad43b8bf1  packages/db/migrations/009_goal_collaboration.sql
d4531535dea777a63f5888f310cd2d0129de9aae32352456cc70172da4197574  packages/db/provision-portals.ts
05ead1031a6001670c90331dc30d01613f5ac84a79e61e94c3e3bc9ced6018a6  packages/db/seed.ts
5aeb91070618d3a5ea950ea2b90eb32e423fa640f2bfcdbdf6d313ed3bea8b53  packages/domain/goal-periods.ts
ee61d41e260966e1912555f48087725e11b1a28a7a747c6921c2dac4f79192c1  packages/domain/rules.ts
dd06769c87111c43795bb32747126e10472b39cf5ea0626c22293c60350c5813  tsconfig.json
BASELINE
}

new_manifest() {
  cat <<'NEW_SOURCES'
dcc93b3481f3f120f6ff71993827607ea99c833e910ba129f4a73054279f5168  apps/web/src/CompanyPortal.tsx
b88e376804a4cfa35059665dec048567404e6512fb829571204b134581a68f57  apps/web/src/main.tsx
104c219f341730ca0b8198982638fc9be6ba95706cdbb52369076e033ea11312  apps/web/src/style.css
a1a43769c32eadbb03651e269583a3d82a0361a24d2b5c411b3638b43a5d15e1  apps/web/src/BusinessCenter.tsx
NEW_SOURCES
}

dist_manifest() {
  cat <<'DIST_FILES'
2190bf6ffa2c05092d16abe94a25c9425d2ce27a2446ffb8d5e071675848b262  dist/web/assets/index-BXmIGvqc.js
fc19d6853547e143b6ebf72f97cda58c161979cd3fa85329cc1ed1e81ae43a47  dist/web/assets/index-dD77JggR.css
c8992333ec4bc450a0da1287bde9b83cf9f3a8a41a17a7d0f9c723339a6aabbb  dist/web/index.html
DIST_FILES
}

compose() {
  "${docker_cmd[@]}" compose --project-directory "$app_dir" \
    -f "$app_dir/compose.yaml" -f "$app_dir/compose.tencent.yaml" "$@"
}

lock_app() {
  mkdir -p "$app_dir/.local"
  exec 9>"$app_dir/.local/portal-home-v1.1.lock"
  flock -n 9 || { echo '另一个首页更新或回滚正在运行，停止。' >&2; return 1; }
}

check_kept_services() {
  local service before current
  while read -r service before; do
    current=$(compose ps -q "$service") || return 1
    [[ -n "$current" && "$current" == "$before" ]] || {
      echo "原 $service 容器发生变化，需要人工核查。" >&2
      return 1
    }
  done < "$state/kept-services.txt"
}

ready() {
  # Reads health, public company data and static assets only. No authenticated writes.
  python3 - "$1" "$2" <<'PY'
import json, re, sys, time, urllib.error, urllib.request
base, version = sys.argv[1:]
def get(path):
    with urllib.request.urlopen(base.rstrip('/') + path, timeout=5) as r:
        return r.read()
last = ''
for attempt in range(30):
    try:
        assert json.loads(get('/api/health'))['status'] == 'ok'
        entries = json.loads(get('/api/v1/public/company-portals'))['data']
        assert isinstance(entries, list) and len(entries) > 0
        if version == 'new':
            html = get('/').decode()
            assets = re.findall(r'(?:src|href)="(/assets/[^"<>]+)"', html)
            scripts = [p for p in assets if p.endswith('.js')]
            assert scripts, 'Missing JavaScript asset'
            assert any('商务服务中心' in get(p).decode() for p in scripts)
            for path in assets:
                assert '..' not in path and get(path)
            for path in ('/business/services', '/business/products', '/business/quotes'):
                assert get(path)
        try:
            get('/api/v1/quotes')
            raise AssertionError('Anonymous quotation access unexpectedly succeeded')
        except urllib.error.HTTPError as e:
            assert e.code == 401
        print('健康、公共入口、静态资源及匿名权限检查通过。')
        break
    except Exception as e:
        last = type(e).__name__
        if attempt < 29:
            time.sleep(1)
else:
    raise SystemExit('就绪检查未通过：' + last)
PY
}

restore_sources() {
  python3 - "$app_dir" "$state" <<'PY'
from pathlib import Path
import hashlib, os, shutil, sys, tempfile
app, state = map(Path, sys.argv[1:])
def manifest(name):
    return {line.split('  ',1)[1]:line.split('  ',1)[0] for line in (state/name).read_text().splitlines()}
old, new = manifest('baseline.sha256'), manifest('new.sha256')
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
for name, expected in new.items():
    path = app/name
    if path.is_symlink() or (path.exists() and digest(path) not in (expected,old.get(name))):
        raise SystemExit('源码有未识别的后续改动，保留文件，请人工核查：'+name)
for name in new:
    path, backup = app/name, state/'source-before'/name
    if name in old:
        assert digest(backup) == old[name], name
        fd, temporary = tempfile.mkstemp(dir=path.parent)
        os.close(fd)
        try:
            shutil.copy2(backup,temporary)
            st=backup.stat()
            os.chown(temporary,st.st_uid,st.st_gid)
            os.replace(temporary,path)
        finally:
            if os.path.exists(temporary): os.unlink(temporary)
    elif path.exists():
        path.unlink()
print('原前端源码及文件权限已恢复。')
PY
}

rollback() {
  echo '正在切回保留的旧 web 镜像…'
  compose -f "$state/compose.rollback.yaml" up -d --no-deps --no-build --pull never web || return 1
  restore_sources || return 1
  check_kept_services || return 1
  # Verify locally even if the public gateway is the cause of the failed release.
  local cid address
  cid=$(compose ps -q web) || return 1
  address=$("${docker_cmd[@]}" port "$cid" 3000/tcp | head -n 1) || return 1
  address=${address/#0.0.0.0:/127.0.0.1:}
  [[ "$address" == 127.0.0.1:* ]] || {
    echo '旧 web 已切回，但本机端口无法自动验证，请核查 HTTPS。' >&2
    return 1
  }
  ready "http://$address" old || return 1
  echo '旧 web 与源码已恢复；worker、数据库和网关容器保持原 ID。'
}

cleanup_candidate() {
  if [[ -n "$candidate" ]]; then
    "${docker_cmd[@]}" rm -f "$candidate" >/dev/null 2>&1 || true
  fi
}

failed() {
  local status=$1
  trap - ERR INT TERM HUP
  set +e
  cleanup_candidate
  echo '首页更新未完成。' >&2
  if (( switch_started )); then
    if ! rollback; then
      echo "自动回滚未能全部验证。请保留输出和 $state，按 rollback.sh 排查，不要重新初始化。" >&2
    fi
  elif (( sources_started )); then
    restore_sources || echo "源码恢复需人工核查：$state" >&2
  else
    echo '原 web 尚未切换。' >&2
  fi
  [[ -z "$state" ]] || echo "检查与备份目录：$state" >&2
  exit "$status"
}

for command in sha256sum python3 docker flock mktemp cp; do
  command -v "$command" >/dev/null || { echo "缺少命令：$command" >&2; exit 1; }
done

if [[ ${1:-} == rollback ]]; then
  state=$(cd -- "${2:?缺少回滚目录}" && pwd -P)
  app_dir=$(cat "$state/app-dir.txt")
  [[ -d "$app_dir" && -f "$state/compose.rollback.yaml" ]] || exit 1
  lock_app
  rollback
  exit
fi

offline=0
if [[ ${1:-} == --offline ]]; then
  offline=1
  shift
  bundle_dir=$(cd -- "$(dirname "$0")" && pwd -P)
  [[ -d "$bundle_dir/payload/apps/web/src" && -d "$bundle_dir/dist/web" ]] || {
    echo '离线包缺少源码或已构建前端，请重新上传完整离线包。' >&2; exit 1;
  }
else
  command -v curl >/dev/null || { echo '在线方式需要 curl；大陆服务器建议使用完整离线包。' >&2; exit 1; }
fi

app_dir=$(cd -- "${1:-/home/ubuntu/ai-sales-9f45fcd}" && pwd -P)
[[ -f "$app_dir/.env" && -f "$app_dir/compose.yaml" && -f "$app_dir/compose.tencent.yaml" ]] || {
  echo '未找到现有应用配置，停止。' >&2; exit 1;
}
# Loopback is accepted solely for isolated rehearsals. Production uses strict HTTPS.
verify_url=${PORTAL_VERIFY_URL:-https://49.233.175.166}
[[ "$verify_url" == https://49.233.175.166 || "$verify_url" =~ ^http://127\.0\.0\.1:[0-9]+$ ]] || exit 1
lock_app
state=$(mktemp -d "$app_dir/.local/portal-v11.XXXXXXXX")
printf '%s\n' "$app_dir" > "$state/app-dir.txt"
baseline_manifest > "$state/baseline.sha256"
new_manifest > "$state/new.sha256"
dist_manifest > "$state/dist.sha256"
trap 'failed "$?"' ERR
trap 'failed 130' INT
trap 'failed 143' TERM
trap 'failed 129' HUP

echo '1/5 核查原项目基线及运行中的服务…'
(cd "$app_dir" && sha256sum --quiet -c "$state/baseline.sha256")
[[ ! -e "$app_dir/apps/web/src/BusinessCenter.tsx" ]] || {
  echo '商务组件已存在，停止以保留现有改动。' >&2; exit 1;
}
for service in worker db gateway; do
  cid=$(compose ps -q "$service")
  [[ -n "$cid" && $("${docker_cmd[@]}" inspect --format '{{.State.Running}}' "$cid") == true ]]
  printf '%s %s\n' "$service" "$cid" >> "$state/kept-services.txt"
done
web_cid=$(compose ps -q web)
[[ -n "$web_cid" && $("${docker_cmd[@]}" inspect --format '{{.State.Health.Status}}' "$web_cid") == healthy ]]
ready "$verify_url" old
old_image=$("${docker_cmd[@]}" inspect --format '{{.Image}}' "$web_cid")
release_id="portal-v11-$(date -u +%Y%m%d%H%M%S)-${RANDOM}"
new_image="ai-sales:$release_id"
old_tag="ai-sales:before-$release_id"
"${docker_cmd[@]}" tag "$old_image" "$old_tag"
printf 'services:\n  web:\n    image: %s\n    pull_policy: never\n' "$old_tag" > "$state/compose.rollback.yaml"
printf 'services:\n  web:\n    image: %s\n    pull_policy: never\n' "$new_image" > "$state/compose.web.yaml"
cp "$0" "$state/update-helper.sh"
printf '#!/usr/bin/env bash\nexec bash %q rollback %q\n' "$state/update-helper.sh" "$state" > "$state/rollback.sh"

if (( offline )); then
  echo '2/5 备份源码，从离线包复制四个前端文件及构建产物并校验…'
  (cd "$bundle_dir/payload" && sha256sum --quiet -c "$state/new.sha256")
  (cd "$bundle_dir" && sha256sum --quiet -c "$state/dist.sha256")
else
  echo '2/5 备份源码，下载固定提交的四个前端文件并校验…'
fi
stage="$state/build"
mkdir -p "$stage" "$state/source-before"
while read -r hash file; do
  [[ ! -L "$app_dir/$file" ]]
  mkdir -p "$stage/$(dirname "$file")"
  cp -p "$app_dir/$file" "$stage/$file"
done < "$state/baseline.sha256"
for file in "${files[@]}"; do
  if [[ -f "$app_dir/$file" ]]; then
    mkdir -p "$state/source-before/$(dirname "$file")"
    cp -p "$app_dir/$file" "$state/source-before/$file"
  fi
  if (( offline )); then
    cp "$bundle_dir/payload/$file" "$stage/$file"
  else
    curl --fail --silent --show-error --location --retry 2 --connect-timeout 15 --max-time 120 \
      "https://raw.githubusercontent.com/Davidwang76/AI-SALES/$source_commit/$file" -o "$stage/$file"
  fi
done
(cd "$stage" && sha256sum --quiet -c "$state/new.sha256")
echo '3/5 构建并检查候选 web；原 web 继续运行…'
if (( offline )); then
  cp -R "$bundle_dir/dist" "$stage/dist"
  (cd "$stage" && sha256sum --quiet -c "$state/dist.sha256")
  # Derive from the ACTUAL running image. Preserve API, Node, dependencies,
  # user, command and healthcheck; copy only verified prebuilt static assets.
  # No syntax directive, RUN, registry pull, npm install, or external build step.
  printf 'FROM %s\nCOPY --chown=node:node dist/web /app/dist/web\n' "$old_tag" > "$stage/Dockerfile"
  printf '*\n!Dockerfile\n!dist\n!dist/**\n' > "$stage/.dockerignore"
  "${docker_cmd[@]}" build --pull=false --network=none -t "$new_image" "$stage"
else
  # Only the 48 known source/config files and four checked frontend files enter the build.
  printf '.env*\n.local\n.git\n' > "$stage/.dockerignore"
  build_args=()
  if [[ -n ${CODEX_PROXY_CERT:-} ]]; then
    [[ -r "$CODEX_PROXY_CERT" ]]
    build_args+=(--secret "id=proxy_ca,src=$CODEX_PROXY_CERT")
  fi
  "${docker_cmd[@]}" build "${build_args[@]}" -t "$new_image" "$stage"
fi
candidate="ai-sales-$release_id-candidate"
compose -f "$state/compose.web.yaml" run -d --no-deps --name "$candidate" \
  -p 127.0.0.1::3000 web > "$state/candidate-id.txt"
address=$("${docker_cmd[@]}" port "$candidate" 3000/tcp | head -n 1)
[[ "$address" == 127.0.0.1:* ]]
ready "http://$address" new
cleanup_candidate
candidate=""

echo '4/5 候选检查通过，更新前端源码并仅切换 web…'
(cd "$app_dir" && sha256sum --quiet -c "$state/baseline.sha256")
[[ ! -e "$app_dir/apps/web/src/BusinessCenter.tsx" ]]
sources_started=1
python3 - "$app_dir" "$stage" "$state/new.sha256" <<'PY'
from pathlib import Path
import os, shutil, sys, tempfile
app,stage,manifest=map(Path,sys.argv[1:])
for line in manifest.read_text().splitlines():
    name=line.split('  ',1)[1]
    path=app/name
    assert not path.is_symlink() and path.parent.resolve().is_relative_to(app)
    fd,temporary=tempfile.mkstemp(dir=path.parent)
    os.close(fd)
    try:
        shutil.copyfile(stage/name,temporary)
        if path.exists():
            shutil.copystat(path,temporary)
            st=path.stat()
            os.chown(temporary,st.st_uid,st.st_gid)
        else:
            os.chmod(temporary,0o644)
        os.replace(temporary,path)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)
PY
switch_started=1
compose -f "$state/compose.web.yaml" up -d --no-deps --no-build --pull never web
check_kept_services

echo '5/5 检查线上健康、新首页资源和匿名权限…'
ready "$verify_url" new
trap - ERR INT TERM HUP
echo '首页更新及自动检查完成。请在电脑和手机浏览器验收公司登录、三个入口和原业务。'
echo "备份目录：$state"
printf '需要回滚时执行：sudo bash %q\n' "$state/rollback.sh"
printf '后续仅重建 web 的配置：%s\n' "$state/compose.web.yaml"
echo '本次没有执行数据库迁移、初始化或账号重置。'
