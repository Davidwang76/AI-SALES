# SRR · AI汽配外贸运营系统

基于上传的 V2.0 需求包开发的浏览器应用，中文管理、英文留资、PostgreSQL 持久化，含独立后台进程。正式初始化为空库，不导入演示客户。原始需求附件和完整内部验收记录保留在开发环境，不随部署分支上传。

**当前版本能运行实际人工业务流程；不等同于163条需求、138条验收均已完成。** 当前交付边界与检查结果见 [版本状态](docs/release-status.md)。尚不能宣称已部署到腾讯云或正式全量上线。

## 运行（推荐 Docker Compose）

要求 Linux、Docker Engine + Compose v2、Python3、curl。首次执行：

```bash
bash scripts/deploy.sh
```

脚本生成强随机数据库及初始账号密码，配置保存在 `.env`（权限600），账号在 `.local/initial-account.txt`，不会输出到日志。默认账号邮箱 `owner@example.com`。初始化脚本重复执行不会重设密码、不会清库。登录后点击右上角头像修改密码，创建公司成员，销毁首次密码文件并移除 `.env` 中不再需要的 `BOOTSTRAP_PASSWORD`。

应用默认仅监听本机3000端口。指定腾讯云服务器已有 Nginx 占用80端口，请使用：

```bash
sudo bash scripts/tencent-deploy.sh
```

此入口保留80端口上的Nginx，在443端口启动HTTPS网关，通过TLS-ALPN-01申请/续签IP短期证书。安全组需允许443/TCP。若443已有其他服务，会停止而不替换它。只有真实HTTPS健康检查通过，才打印访问成功；目前仅在开发环境验证配置，尚未在腾讯云签发证书。详见 [部署手册](docs/deployment.md)。

若部署到没有现有网关的其他机器，可使用 `compose.https.yaml` 配置同时接管80/443。不要在已有Nginx占用80时使用该通用入口。

## 开始实际工作

1. 登录后在「团队与权限」添加成员，正式库没有固定测试客户或交易。
2. 在「批准资料」登记公司/产品原文并审批；「市场开发」设置实际国家、品类和预算。
3. 「展会与推广」建立活动；展会用「现场采集」，线上活动打开英文留资表单。
4. 「线索处理」核对原件、确认企业与负责人。同企业选已有客户，保留多次来源。
5. 「客户资产」登记联系人、证据、评分和后续任务；「沟通收件箱」登记真实来信与人工草稿。
6. 「标准询盘」逐行澄清、匹配产品；「采购与回盘」登记回盘、比较单位与品质并选择货源。
7. 「报价与审批」选择询盘及有效货源，输入汇率和毛利，服务端计算后审批。批准与外发分开。
8. 依据客户确认建立订单，登记样品、分批发货、单证、财务核实/核销和售后。财务与客户经营视图通过API可查询按币种明细。

模型、搜索、邮箱、WhatsApp、OCR、ERP及广告不是默认已连接。当前邮箱为人工记录，系统不自动发信、不投放广告、不付款；这些真实集成须提供相应官方授权并完成验收。模型文本接口已有真实调用实现，配置后还需实际联调。

## 本地开发

Node.js 24 LTS，依赖在 `package-lock.json` 锁定。先启动 PostgreSQL17（开发库和正式库隔离）：

```bash
npm ci
export DATABASE_URL='postgres://sales:YOUR_PASSWORD@127.0.0.1:5432/sales'
npm run db:migrate
# 设置自己的 BOOTSTRAP_EMAIL / BOOTSTRAP_PASSWORD 后：
npm run db:seed
npm run build
npm start
# 另一终端：
npm run worker
```

开发时可用 `npm run dev` 启动API，`npx vite --config apps/web/vite.config.ts` 启动前端热更新。`.env` 只包含本地私有值，不提交仓库。每个云任务已经隔离，使用现有 checkout，无需新建 worktree。

## 检查

```bash
npm run typecheck
npm run build
# 业务测试强制独立数据库名包含 sales_test，拒绝对正式库运行：
DATABASE_URL='postgres://sales:YOUR_PASSWORD@127.0.0.1:5432/sales_test' npm test
# E2E需另一个独立库、合成测试账号及 Chromium，详见 playwright.config.ts
npm run test:e2e
npm audit --omit=dev --audit-level=high
```

运行及维护：[部署/恢复](docs/deployment.md) · [API约定](docs/api.md) · [连接清单](docs/integrations.md)。
