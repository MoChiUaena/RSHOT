# 部署 RSHOT

首版推荐一台 2 核、4 GB 内存、至少 50 GB 磁盘的 Linux 云服务器，使用 Docker Compose。平台比较见 [部署平台选择](deployment-options.md)。模型费用、域名和备份另计。

## 1. 先启动网页预览

需要 Git、Node.js 24.11+、Docker Engine 与 Compose 插件。以下命令在服务器上的部署用户下执行：

```bash
git clone https://github.com/MoChiUaena/RSHOT.git
cd RSHOT
node scripts/init-env.ts --preview
docker compose up -d --build db setup api web
docker compose exec -T api node scripts/seed-curated.ts --apply
```

`init-env.ts` 生成忽略的 `.env`，其中包含随机数据库密码、签名密钥和管理员密码；自动采集与模型调用默认关闭。管理员密码会显示一次，请保存在自己的密码管理工具中。已有 `.env` 不会覆盖。

网页在 `http://服务器地址:3000`，后台在 `/admin`。编辑包只导入可追溯的历史资料，不复制本机数据库、私人标注或模型回执。

Compose 包含 `db`（PostgreSQL 17）、`setup`（迁移、种子与采集限额初始化后退出）、`api`、`web`；后续启用 `worker` 负责持续更新。生产数据库沿用框架内部名称 `aihot`。数据库端口不对外暴露。

`setup` 会在首次部署时建立最近 48 小时的采集窗口、明确的信源名单，以及每轮 2 条、每小时 4 条、每天 10 条、每信源每天 3 条的滚动限额。模型请求最多每分钟 20 次、每小时 60 次、每天 200 次。已有策略、暂停状态和更低或为零的模型预算会保留；配置无效时部署准备失败。详见 [自动更新](automatic-updates.md)。

## 2. 给 worker 注入仓库外的模型配置

在服务器上创建部署用户可读取的私有配置目录，用编辑器填写文件：

```bash
mkdir -p ~/.config/RSHOT
chmod 700 ~/.config/RSHOT
nano ~/.config/RSHOT/models.env
chmod 600 ~/.config/RSHOT/models.env
```

文件包含以下字段，密钥只填在服务器本地文件中：

```dotenv
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=
LLM_API_KEY=
LLM_EXTRA_JSON={"enable_thinking":false}
COLLECT_ENABLED=true
MODEL_CALLS_ENABLED=true
ANALYZE_CONCURRENCY=1
FETCH_CONCURRENCY=2
FEISHU_CONTENT_PUSH_ENABLED=false
FEISHU_INTERNAL_ENABLED=false
INDEXNOW_SUBMIT_ENABLED=false
```

地址、区域、模型标识和密钥必须对应同一服务。`enable_thinking:false` 仅用于已经验证支持该参数的千问模型；其他模型改为 `{}`。服务器可使用单独的受限密钥，配置后先做连接与少量内容验证，见 [模型配置](model-setup.md)。

在项目的 `.env` 中增加 `RSHOT_MODEL_ENV_FILE`，值为这个文件的实际绝对路径，例如 `/home/deployer/.config/RSHOT/models.env`，不要写 `~`。保持项目 `.env` 中的 `COLLECT_ENABLED=false`、`MODEL_CALLS_ENABLED=false`，模型密钥保持空值。Compose 只向 worker 叠加私有文件，网页和 API 不接收其中的模型密钥。

核对配置并启动 worker：

```bash
docker compose config --quiet
docker compose up -d worker
docker compose exec -T api node scripts/updates-status.ts
```

状态命令不调用模型。`docker compose config --quiet` 只验证格式；完整的 `docker compose config`、`docker inspect` 或环境变量输出可能含凭据，不应粘贴到聊天、Issue 或公开日志中。

worker 使用 `restart: unless-stopped`，服务器启动 Docker 后可恢复；有序退出允许最多 4 分钟完成正在执行的请求。停止与恢复：

```bash
docker compose stop worker
docker compose up -d worker
```

`npm run updates:stop` 用于本机启动器。Compose 运行时请使用上面的停止命令，避免容器的自动重启策略把 worker 再次拉起。

## 3. 配置域名和 HTTPS

将域名的 DNS 指向服务器，在 `.env` 中设置读者实际访问的地址：

```dotenv
SITE_URL=https://example.com
SITE_DOMAIN=example.com
PORT=127.0.0.1:3000
TRUST_PROXY=true
```

服务器防火墙开放 TCP 80/443，SSH 仅向自己的管理入口开放。3000 绑定本机，3001 与数据库只在 Compose 内部使用。然后执行：

```bash
docker compose --profile https up -d
docker compose run --rm --no-deps --entrypoint node setup scripts/smoke.ts --base https://example.com
```

Caddy 自动申请并续期证书。已有 Nginx 时，可反向代理到 `http://127.0.0.1:3000` 并传递 `X-Forwarded-For`，保持 `TRUST_PROXY=true`。

公开上线前，需要运营者确认 `industry/pages/` 的使用规则和隐私模板，填写运营主体、联系邮箱及域名；此要求来自项目 `AGENTS.md`。中国大陆服务器对外提供网站服务需办理适用的 ICP 备案，在 `industry/site.ts` 填入备案号。其他地域也需按服务商和所在地的要求上线。

## 4. 网络与维护

在目标服务器运行 `docker compose exec -T api node scripts/check-sources.ts`，核对信源可达性。需要出站代理时，在私有配置中填写 `EGRESS_PROXY_URL`；本机的 `127.0.0.1` 代理不能直接用于云服务器。模型请求使用模型自身地址，不走信源出站代理。

中国大陆机器构建时可按需要切换 npm 镜像：

```bash
docker compose build --build-arg NPM_REGISTRY=https://registry.npmmirror.com
docker compose up -d
```

更新代码前先备份，再拉取并重建；`setup` 自动执行增量迁移并保留已有采集策略和预算：

```bash
git pull --ff-only
docker compose --profile https up -d --build
```

日报于北京时间 08:00 生成已完成统计窗口的内容。自动任务保留已有日报，不覆盖人工编辑版。后台“运行”和“信源”页面可查看任务与读取状况。

查看日志：

```bash
docker compose logs --tail 100 api worker web
```

日志保留在服务器本地；服务商报错正文也可能含敏感内容，分享前只摘取状态、任务和已清理的错误说明。

## 5. 备份

数据库、媒体与本地缓存、Caddy 证书分别存放在 `db`、`data`、`caddy` Docker 卷。`docker compose down` 保留卷；`docker compose down -v` 会删除数据。

用部署用户私有目录保存手动数据库备份：

```bash
mkdir -p ~/.local/share/RSHOT/backups
chmod 700 ~/.local/share/RSHOT/backups
umask 077
docker compose exec -T db pg_dump -U aihot aihot | gzip > ~/.local/share/RSHOT/backups/rshot-$(date +%F-%H%M%S).sql.gz
```

备份包含私有数据和后台设置，请放在仓库外，并保留异地副本。自动 S3 兼容备份的 `DB_BACKUP_STORE_*` 字段放入 worker 的私有文件；配置和恢复方式见框架运维文档。服务器快照与数据库备份的费用不含在基础实例价格中。

## 不用 Docker

需要 Node.js 24.11+、PostgreSQL 16/17，以及 systemd 或其他进程管理器。先安装依赖、生成关闭安全阀的 `.env`、设置 `DATABASE_URL` 和 `API_BASE_URL`，然后依次运行：

```bash
npm ci
node --env-file=.env scripts/migrate.ts
node --env-file=.env scripts/seed.ts
node --env-file=.env scripts/prepare-collection.ts --apply
npm run build -w @aihot/web
node --env-file=.env apps/api/src/main.ts
# 在另一个服务进程中启动网页：
cd apps/web
NODE_ENV=production node --env-file=../../.env server.ts
```

worker 的服务配置单独注入仓库外的模型文件，启动 `apps/worker/src/main.ts`，并设置至少 4 分钟的停止等待时间。生产环境不要设置 `DEV_AUTH_ROLE`。本机开发流程见 README 与 [自动更新说明](automatic-updates.md)。
