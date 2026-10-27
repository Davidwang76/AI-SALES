# 部署、备份与恢复

## 腾讯云目标

- 用户指定：腾讯云，49.233.175.166，SSH用户ubuntu；未提供另一个SSH端口，采用22。
- 当前环境的受控TCP代理 `proxy:8088` 连接被拒绝，常规与提权只读检查结果一致。没有使用聊天中的密码，没有建立SSH会话，没有变更目标服务器。
- 不把密码/私钥写入仓库、部署包、`.env` 或脚本。聊天中公开过的密码应更换。云账号ID不是SSH认证信息。

## 首次安装

通过腾讯云控制台的登录终端，将交付包上传至独立目录，例如 `/home/ubuntu/ai-sales`，不要覆盖已有项目。先检查：

```bash
uname -m
free -h
df -h
ss -ltn
sudo docker version
sudo docker compose version
```

建议2核4GB以上作为小团队初始运行条件，未做容量达标承诺。若没有Docker，请依照Docker的Ubuntu官方安装文档安装Engine与Compose插件，保留仓库签名与TLS校验；本项目脚本不使用curl-pipe-shell或关闭校验。

```bash
cd /home/ubuntu/ai-sales
bash scripts/deploy.sh
```

脚本只操作本Compose项目，不移除现有服务，不开放防火墙，不执行 `down -v`，不清库。初始化的数据库、私有附件分别有持久卷；web与worker进程必须重启，不能只依赖已安装文件。

初始账号见 `.local/initial-account.txt`。配置文件为600权限。改完首次密码后删除临时密码文件、清除BOOTSTRAP_PASSWORD，再重新部署以移除一次性初始化容器中的值。

## IP地址HTTPS

`deploy/Caddyfile` 显式使用 ACME `shortlived` profile，为指定IP申请公共信任的短期证书并自动续签，避免默认IP自签证书。Caddy镜像已锁定digest，配置 `caddy adapt --validate` 已通过；**未完成远程证书签发与公网验证**。

确认腾讯云安全组和服务器防火墙允许80/TCP、443/TCP入站；SSH只向实际管理来源开放。不要暴露PostgreSQL端口。若服务器已有80/443服务，复用原网关或由管理员分配入口，不能直接抢占端口。

```bash
docker compose -f compose.yaml -f compose.https.yaml up -d gateway
docker compose -f compose.yaml -f compose.https.yaml logs --tail=80 gateway
```

申请失败时保留错误证据，检查80端口挑战可达性、出口ACME和CA当前IP/profile支持；不要改成跳过TLS验证。若CA不支持或该IP无法签发，需绑定由用户控制的域名并改Caddyfile站点，再启用真实登录。HTTP入口会重定向到HTTPS；COOKIE_SECURE=true。

## 配置与健康检查

- `docker compose ps` 检查db/web/worker健康；migrate成功退出是正常状态。
- `/api/health` 检查API与真实数据库。
- `/api/v1/reports/runtime` 授权后检查worker最近心跳、任务状态。模型任务失败会进入needs_manual，不冒充成功。
- 创建真实活动→采集线索→转客户→刷新与重启确认存在；正式业务测试由授权操作人录入真实来源。
- 设置每日备份计划，例如使用 systemd timer 执行 `bash scripts/backup.sh`。部署包不会擅自修改服务器系统定时器。

## 备份

```bash
bash scripts/backup.sh
```

短暂停止本项目web/worker，`pg_dump -Fc` 与私有附件打包，生成SHA256校验，再恢复进程；不要在存在其他写入者时声称两者一致。`database.dump`、`files.tar`、`SHA256SUMS` 置于 `.local/backups/<UTC时间>/`，文件权限限制。`.env`与TLS私有数据需按公司策略单独加密保管。备份需复制到另一受控主机；本机备份不防整机丢失。

## 隔离恢复（不覆盖正式数据）

```bash
RESTORE_DATABASE=sales_restore_check bash scripts/restore.sh .local/backups/<UTC时间>
```

脚本拒绝非 `sales_restore_` 前缀和已存在数据库，先验校验和，再恢复到新数据库。恢复后的表数、关键ID、关联、审计和金额核对通过后，才可安排维护窗口切换；附件先解压到独立目录并逐个核验sha256。当前脚本不会自动切换正式连接或覆盖附件。

## 发布与回滚

每次更新先备份，记录镜像ID，构建新标签，例如APP_TAG=release_20261028。迁移为顺序、事务性、带版本记录的增量迁移。当前迁移不提供破坏性down脚本。回退代码只在新schema向后兼容时使用旧镜像；不能以恢复整库去抹除已发生交易、审计或外发事实。

## 架构取舍及限制

- PostgreSQL既是事实来源，又是持久任务队列；使用事务、SKIP LOCKED、唯一键和状态管理。当前未引入Redis第二队列，避免双写真相。
- 文件是私有卷的不可执行对象，UUID随机存储键，通过授权API下载；未部署S3/MinIO。缺少病毒扫描与PDF/媒体内容消毒，上传只检查类型、头部和大小；正式启用不可信大规模上传前需补齐。
- 已完成本地容器、重启和隔离恢复演练，不代表腾讯云、跨机器恢复、RPO/RTO或10万线索性能已达标。


## 已有Nginx时的腾讯云部署入口

用户服务器截图确认Ubuntu24.04、Docker可用且当前没有运行中的容器；80端口显示Nginx欢迎页。使用 `sudo bash scripts/tencent-deploy.sh`，不卸载或重写现有Nginx。

`compose.tencent.yaml` 只发布443/TCP和443/UDP，`deploy/Caddyfile.tencent` 关闭自动HTTP跳转及HTTP-01挑战，显式使用IP短期证书与TLS-ALPN-01。配置已通过Caddy解析/验证，证书尚未在公网目标签发。安全组至少需允许443/TCP。

若443已被其他服务占用，脚本保留它并停止；不能抢占端口。若应用启动但HTTPS未通过，检查网关日志与443可达性，不重复初始化或删除数据卷。进入应用请用 `https://49.233.175.166`，HTTP上仍可能是原Nginx欢迎页。
