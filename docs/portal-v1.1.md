# 工作与生活门户 V1.1：首页与商务入口

## 原项目及本次范围

原项目为 `Davidwang76/AI-SALES` 的 `deploy/ai-sales-cloud` 分支，基线提交 `5f4597c6dbd04c0d25362b5d15eeda5cf5fd170e`。仓库部署手册中的目标为腾讯云 `49.233.175.166`，SSH 用户 `ubuntu`，既有更新脚本默认目录 `/home/ubuntu/ai-sales-9f45fcd`。这些是原项目记录，尚未通过本轮 SSH 核实线上当前目录和版本。

后续核对：用户已通过服务器控制台确认运行目录 `/home/ubuntu/ai-sales-9f45fcd`，web、worker、db 健康，gateway 运行。服务器只读 SHA256 输出中 48 个基线文件全部匹配；其中 16 个文件需 sudo 读取，补查同样匹配。此证据确认磁盘源码基线，没有直接 SSH 接入或实际上线的含义。

继续使用 Node.js 24、React、Vite、Fastify、PostgreSQL 17 及原有 Docker Compose 部署。本次应用改动仅限四个前端文件：`CompanyPortal.tsx`、`BusinessCenter.tsx`、`main.tsx`、`style.css`。没有数据库迁移、依赖或锁文件变更，没有修改原认证、公司成员权限或业务 API。

- 首页在大于 900px 时左右 2:1 分栏，左侧公司卡片两列；900px 及以下上下排列，420px 及以下公司卡片一列。原有个人/家庭修炼、季月旬目标入口保留。
- 公司列表仍读取原 `public/company-portals` 接口，原公司 URL、账号和登录校验保留。前端不截断数量，路由兼容三位数及更长的公司编号。
- `/business/services` 可匿名查看三类服务、待授权案例说明和咨询指引。尚无经过确认的公开联系方式或案例，当前没有咨询提交或收集功能。
- `/business/products` 可匿名查看服务包/软件产品分类并展开适用企业与范围说明。正式产品目录、详情数据与后台维护尚未接入，不将静态介绍称为后台管理。
- `/business/quotes` 为公司选择页；选择后进入 `/company/01?tool=business-quotes` 等现有公司登录路径。使用原会话和成员校验，通过后进入独立全宽“商务报价工作台”。错误公司账号拒绝，退出和刷新仍需登录。该页当前为业务待开放状态，不读取或套用原汽配报价数据。

## 阶段边界

第一阶段交付布局与入口。客户管理、服务与产品价格库、计算、审批、正式 PDF、客户专属确认链接、版本和报价权限管理按后续阶段建设。公司、签约主体和客户公开确认权限须在正式报价设计中分别定义，复用原账号与授权机制。

**公司数量的既有限制：** 原迁移 `006_company_portal.sql` 对 `company_portals.slot` 有 `BETWEEN 1 AND 9` 约束，原初始化程序也只处理 01—09。本次没有擅自修改数据库。前端无新增数量限制，但完整实现超过 9 个公司仍需要单独评审、备份、测试并执行兼容性迁移；当前不能宣称系统已经支持无限新增。

## 本轮验证

在独立 PostgreSQL 17、合成账号和 Chromium 中执行，未连接生产数据库：

| 检查 | 结果 |
| --- | --- |
| `npm ci --no-audit --no-fund` | 按原锁文件安装成功 |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `npm test` | 61 项通过，0 失败、0 跳过 |
| `npm run test:e2e` | 12 条通过，0 失败、0 跳过；含新增 5 条、原有 7 条 |
| 原 `Dockerfile` 构建及镜像功能请求 | 通过；验证真实数据库健康、9 个公司、三个入口、公共介绍、平板全宽页面及匿名报价 API 拒绝 |
| 源码补丁及逆向恢复 | 对原基线应用成功，4 个前端文件与本次修改一致；反向应用后所有基线文件的 SHA256 与文件清单完全一致 |
| `npm audit --omit=dev --audit-level=high` | 通过 high 阈值；原生产依赖有 3 项 moderate，0 high/critical，未升级依赖或修改锁文件 |

新增浏览器检查覆盖真实公司数据、2:1 和两列布局、900/701/700/390/320px 的上下布局及无溢出、匿名公共介绍、详情展开、刷新和返回、错误公司登录拒绝、报价页面鉴权及退出、公司接口失败与重试。超过 9 个公司及三位数编号仅用隔离的接口测试替身验证前端，不代表现有数据库已经解除限制。

既有浏览器流程覆盖原获客、弱网采集、汽配报价审批到订单、粘贴采集、公司登录、个人/家庭导航和目标管理。目标 AI 流程使用既有本地模型测试替身与合成配置，没有调用真实模型，也不代表真实 AI 服务已联通。

原依赖审计的 moderate 项涉及 `glob` 的取消后遍历、`minimatch` 的潜在拒绝服务及其上游 `@fastify/static`。这是本次检查发现的既有依赖问题，需另行评估升级与兼容性；本次不自动运行 audit fix。源码反向补丁已验证，不等于已完成服务器镜像切换回滚演练。

首轮发现的首页 `aside` 全局样式冲突已通过仅限商务模块的样式覆盖修正。另一个首轮失败来自测试未设置模型启用配置；设置仅用于测试的合成参数后，全套复验通过。没有改动旧测试断言或目标管理业务。

### 在当前云环境复验

使用现有 checkout，不创建 worktree。当前依赖和私有合成测试配置在 `/workspace/AI-SALES`；不要把测试配置应用到正式服务器或输出其值。

```bash
cd /workspace/AI-SALES
npm run typecheck
npm run build
# .local/cloud-tests.env 仅为本环境的合成测试配置，不能提交仓库。
set -a
source .local/cloud-tests.env
set +a
npm test
```

端到端测试使用另一个新建、名称包含 `sales_e2e` 的空数据库，先执行原有迁移、种子和公司初始化。初始化账号输出须重定向到权限 600 的私有文件。`MODEL_API_KEY=synthetic-browser-test-only`、`MODEL_NAME=synthetic-browser-test`、`MODEL_ENDPOINT=http://127.0.0.1:9` 仅用于使本地替身流程可用；不启动会调用真实模型的 worker，不写入正式配置。然后执行 `npm run test:e2e`。原有交易测试会录入合成数据，不应在已有业务数据的数据库运行。

## 部署前置检查

以下是面向原 Docker Compose 部署的操作方案，尚未在腾讯云服务器执行。须先取得受控 SSH 接入或由管理员在云控制台执行。不要在聊天中发送密码、私钥或 `.env` 内容。

1. 只读确认实际部署目录、运行中的 web/worker/db/gateway、现有 Compose 项目和网关；核实线上版本与上述源码基线一致。不要因为记录中有默认目录就直接覆盖它。
2. 若使用交付包，先在其解压目录执行 `sha256sum -c SHA256SUMS`，再进入实际应用目录，执行 `sha256sum -c /tmp/portal-v1.1-release/baseline.sha256`。清单覆盖基线应用源码、数据库源码、依赖清单及部署文件；任一差异、缺文件或新组件同名文件已存在，都应先核对线上改动，不能强行覆盖。
3. 确认原公司完整清单、原登录及 HTTPS 健康。保留上一镜像和前端源码备份。本次只切换 web，不运行旧的 `update-company-portal.sh`，因为该脚本还会执行数据库迁移及公司初始化，不适合本次纯前端更新。
4. 先在预发布按下述方式演练构建、web 切换和回滚，再安排正式变更窗口。

## 控制台更新助手

`scripts/update-portal-home-v1.1.sh` 将上述步骤封装为可核查、可恢复的操作。由现有服务器控制台以 sudo 运行，参数为已核实的应用目录；脚本下载和 SHA256 校验固定源码提交 `64363b81d080845f1909462e5d902cd35643ab59` 的四个前端文件，不跟随可变分支。

1. 重查全部 48 个基线文件、现有容器及当前 HTTPS 健康，保留旧 web 镜像，备份被替换源码及原权限。
2. 在 `.local/portal-v11.*` 的隔离构建目录复制已核查源码，下载并核验四个新文件。构建目录不复制 `.env` 或用户凭据。
3. 构建独立镜像，启动仅映射本机随机端口的候选 web，使用现有连接与卷进行健康、公共公司入口、前端资源、公共路由及匿名报价 API 拒绝检查。所有探测仅为 GET，不执行迁移、初始化或业务写入。
4. 检查通过后再原子替换四个前端文件，并用 `--no-deps --no-build --pull never` 只切换 web。其他三个容器必须保持原 ID。正式请求使用正常校验证书的 `https://49.233.175.166`。
5. 检测到切换后的检查失败等可捕获错误时，尝试自动恢复旧 web 镜像及源码；保留状态目录与可从任何工作目录执行的 `rollback.sh`。后续源码如有未识别改动，恢复会停止并要求人工核对，避免覆盖新工作。

正常更新后仍须在真实电脑、手机验证公司登录、三入口和原业务。脚本自动检查不代替人工验收；自动检查通过也不代表报价业务已开发。中断后可使用保留的回滚命令检查和恢复。

在隔离 Compose 栈中已演练正常更新、手动回滚，以及模拟网关在新版本切换后返回 503 的自动回滚；旧镜像、全部 48 个文件哈希及 worker/db/gateway 原容器 ID 均已核验。演练使用合成数据库与仅监听本机的测试代理，不代表生产腾讯云已部署或实际 Caddy 的 HTTPS 路径已复验。

`PORTAL_VERIFY_URL` 仅允许脚本内固定的生产 HTTPS URL，或本机 `127.0.0.1` 地址供隔离演练；正式运行不设置该变量。助手不修改 `.env`、数据库或原 Compose 配置。成功后保存输出的 `compose.web.yaml`，后续 web 重建仍需带该覆盖文件；回滚使用同目录 `rollback.sh`。

## 仅更新 web 的操作方案

以下示例假定交付包已解压到 `/tmp/portal-v1.1-release`，操作者已进入核实过的原应用目录，并具有现有 Docker 权限。应在同一个 Bash 会话中依次执行；遇错停止。不能更换 Compose 项目、数据库卷或网关。

```bash
set -euo pipefail
umask 077
release_dir=/tmp/portal-v1.1-release
test -f .env && test -f compose.yaml
sha256sum -c "$release_dir/baseline.sha256"
test ! -e apps/web/src/BusinessCenter.tsx
git apply --check "$release_dir/source.patch"

release_id="portal-v11-$(date -u +%Y%m%d%H%M%S)"
backup_dir="$(pwd)/.local/$release_id"
mkdir -p "$backup_dir"
web_container=$(docker compose ps -q web)
test -n "$web_container"
old_image=$(docker inspect --format '{{.Image}}' "$web_container")
docker tag "$old_image" "ai-sales:before-$release_id"
tar -czf "$backup_dir/frontend-before.tar.gz" \
  apps/web/src/CompanyPortal.tsx apps/web/src/main.tsx apps/web/src/style.css
cp "$release_dir/source.patch" "$backup_dir/source.patch"
printf 'services:\n  web:\n    image: ai-sales:before-%s\n    pull_policy: never\n' \
  "$release_id" > "$backup_dir/compose.rollback.yaml"

git apply "$release_dir/source.patch"
# 原 Dockerfile 与依赖版本不变；正式服务器按原可信网络构建。
docker build -t "ai-sales:$release_id" .
printf 'services:\n  web:\n    image: ai-sales:%s\n    pull_policy: never\n' \
  "$release_id" > "$backup_dir/compose.web.yaml"
docker compose -f compose.yaml -f "$backup_dir/compose.web.yaml" \
  up -d --no-deps --no-build --pull never web
curl --fail --silent --show-error --max-time 10 \
  https://49.233.175.166/api/health
```

云环境内构建若经平台代理，需按 cloud runtime 技能给原 Dockerfile 的 `proxy_ca` BuildKit secret 传入平台 CA；不能关闭 TLS/签名/校验。生产服务器继续使用其原有受信任配置。

web 需要启动时间，健康检查暂时失败时先查看本项目 web 状态，保留旧镜像和备份；不要重新初始化数据库或删除数据卷。健康通过后仍要用浏览器验证 IP 首页、静态资源、三个入口、所有公司入口、现有登录和关键业务。记录实际结果，不能仅凭容器运行或 `/api/health` 成功宣称首页验收通过。

这次没有修改 `.env` 的 `APP_TAG`，也不重启 worker。记录并保留本次 `compose.web.yaml`；后续启动或维护 web 应继续带该覆盖文件，直接用原基础 Compose 配置重建 web 会回到其原镜像设置。

## 回滚方案

触发条件：现有登录或公司入口异常、越权、关键路由不可用、静态资源大量失败，或首页不符合验收。切回保留的旧镜像并核验，保留本次日志和补丁供诊断。

```bash
# 使用本次部署所记录的 backup_dir，不选择不明的历史备份。
test -f "$backup_dir/compose.rollback.yaml"
docker compose -f compose.yaml -f "$backup_dir/compose.rollback.yaml" \
  up -d --no-deps --no-build --pull never web
curl --fail --silent --show-error --max-time 10 \
  https://49.233.175.166/api/health
# 防止下次构建重新带回本次前端；源码没有后续变更时才反向应用。
git apply --reverse --check "$backup_dir/source.patch"
git apply --reverse "$backup_dir/source.patch"
```

如果源码在部署后又有修改，反向补丁检查会失败，此时保留原文件人工合并，不强制恢复旧源码。`frontend-before.tar.gz` 可用于核对，不盲目覆盖后续改动。回滚后复验原首页、公司登录和关键业务；继续维护旧版 web 时带 `compose.rollback.yaml`。本次没有改数据库，不恢复旧数据库去覆盖部署期间新增的业务数据。

## 仍待完成

- 服务器目录和 48 个磁盘源码文件已通过用户控制台输出核对；待用户在控制台运行更新助手，完成真实 HTTPS 检查、电脑/手机人工验收。本轮没有直接 SSH 接入，本地演练结果不等于已上线。
- 让环境设置中已保存的 `49.233.175.166`、`api.github.com` 访问配置生效；前者用于读目标站点，后者用于列举私有仓库及 GitHub API 操作。Git 原生读取已可用，不能据此假定 API 或 SSH 权限可用。
- 经确认的案例、公开咨询渠道、正式产品及后台维护、完整商务报价业务、超过 9 个公司的数据库扩展，按后续阶段交付。
