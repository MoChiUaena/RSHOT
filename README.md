# RSHOT

面向遥感研究者与工程师的中文资讯站，覆盖传统遥感、地球观测（EO）与 GeoAI。基于 [AIHOT](https://github.com/KKKKhazix/AIHOT) 的 MIT 开源框架修改，使用独立名称与品牌。

## 这一版包含什么

- 六类内容：论文方法、数据基准、模型工具、卫星传感器、应用实践、行业政策。
- 29 个主题：机构与平台、技术方向、内容形态。
- 20 个已启用信源：arXiv、ESA、Copernicus Data Space、NASA Earthdata、中国科学院空天院、ESSD、重点开源项目发布订阅，以及通过实机读取核验的 4 个 X 账号和 2 个微信公众号。
- 遥感相关性预筛、五维评分、中文摘要、事件归组、日报/周报/月报、RSS/API/MCP。
- 独立图标与遥感日报报头，关闭通用 AI 模型榜与额度重置监控。

信源名单、读取验证和候选来源见 [信源报告](docs/rshot-sources.md)。只展示摘要和原文链接。第一次收录的历史资料按原文日期归档。

精选优先考虑可追溯的可靠出处、方法实质创新和工具新增能力，兼顾各遥感方向，见 [精选依据](docs/editorial-policy.md)。个人偏好标签用于查看分歧，评测会注明参考类型。

## 快速预览（Docker）

先在线浏览免费只读预览：**[RSHOT GitHub Pages](https://mochiuaena.github.io/RSHOT/)**。包括公开精选、摘要、搜索分类、日报与简报；页面标明导出时间。采集和模型处理仍在本机，见 [免费预览说明](docs/pages-preview.md)。

需要 Docker 与 Node.js 24.11+，无需模型 API 密钥。

```bash
git clone https://github.com/MoChiUaena/RSHOT.git
cd RSHOT
node scripts/init-env.ts --preview
docker compose up -d --build db setup api web
docker compose exec -T api node scripts/seed-curated.ts --apply
```

打开 <http://localhost:3000>。首次构建会安装依赖；来源日期和原文链接可在站内核对。预览模式关闭自动采集与模型调用，不启动 worker。

## 当前编辑包

`industry/curation/2026-09-29.json` 收录 47 条来自 10 个来源的真实资料，其中 45 条进入编辑精选。由助手依据原文或摘要整理，供使用者复核；没有站点模型评分。

导入后包含 12 期日报、2 期完整周报，以及注明截至日期的月度观察。历史内容保持原始日期，不推送为新消息。仅更新本编辑包自己的结果，已有模型判断或人工覆盖设置会保留。

- [编辑包与导入说明](docs/curation.md)
- [内容覆盖与后续信源缺口](docs/content-coverage.md)

## 本机开发预览（Windows）

需要 Node.js 24.11+、Docker Desktop。先启动独立本地数据库（已有 `rshot-dev-db` 时跳过）：

```powershell
docker run -d --name rshot-dev-db -p 127.0.0.1:18777:5432 -e POSTGRES_PASSWORD=rshot-local-dev-only -e POSTGRES_DB=rshot_dev postgres:17-alpine
```

示例密码仅用于这个绑定本机的开发数据库；`.env` 的 `DATABASE_URL` 可设为 `postgres://postgres:rshot-local-dev-only@127.0.0.1:18777/rshot_dev`。Docker Compose 部署使用 `init-env.ts` 生成的随机密码。

```powershell
npm ci
node scripts/init-env.ts --preview
```

在 `.env` 中设置 `DATABASE_URL`（本地开发库名以 `_dev` 结尾），并将 `COLLECT_ENABLED` 和 `MODEL_CALLS_ENABLED` 设为 `false`。已有 `.env` 时不需要重新生成。

```powershell
node --env-file=.env scripts/migrate.ts
node --env-file=.env scripts/seed.ts
node --env-file=.env scripts/seed-curated.ts --apply
npm run build -w @aihot/web
pwsh -NoProfile -File scripts/start-local.ps1
```

打开 <http://localhost:3000>。预览内容是明确标记的编辑整理摘要，不包含模型评分，也不调用付费接口。后台在 `/admin`，密码在 `.env` 的 `ADMIN_PASSWORD`。

## 启用自动采集与精选

本机可按 [自动更新说明](docs/automatic-updates.md) 启动受限 worker，控制首次采集窗口、每轮数量与滚动限额，并保护已有编辑内容。

1. 本机先运行 `npm run model:prepare`，将模型配置填进仓库外的 `models.env`。用连接测试与 1–5 条资料试运行核对接口、输出与 token 开销，见 [模型配置与试运行](docs/model-setup.md)。Docker 部署通过服务器私有环境注入模型配置。
2. 运行 `node --env-file=.env scripts/check-sources.ts`，确认部署机器能读取信源。需要网络代理时设置 `EGRESS_PROXY_URL`；本机现有配置不适合直接复制到云服务器。
3. 用 100–200 条自己标注的遥感内容校准筛选标准。当前门槛仍沿用上游，编辑包和示例样本都不是已经完成人工标注的校准集，见 [精选与校准](docs/selection.md)。
4. 本机用 `scripts/start-updates.ts --live` 为 worker 单独启用采集与模型；Docker 的 `setup` 初始化同样的限额，再按 [部署流程](docs/deploy.md) 给 worker 注入仓库外配置。网页与 API 的开关保持关闭。
5. 公开发布前填写运营主体、联系方式与域名，并确认 `industry/pages/` 中的使用规则和隐私草案。

付费调用在 worker 中完成，读者打开页面不触发模型调用。每日预算可在后台设置。热点榜衡量 48 小时内的多来源讨论；单一来源的重要成果仍可进入精选与日报。

## 密钥与 GitHub

模型密钥保存在仓库外，`.env` 与 `.data/` 保持忽略。安装依赖后运行 `npm run setup:hooks`，启用提交前和推送前检查；GitHub CI 也会检查文件与提交历史。检查只报告位置与规则，不打印密钥。详见 [配置与发布保护](docs/model-setup.md)。

## 人工标注页面

后台 `/admin/calibration` 用于标注精选偏好：查看来源材料和中文导读，选择“值得精选 / 不精选 / 拿不准”，填写可选备注。进度保存在私有数据库，刷新后可以继续；页面不调用模型，也不发布这些判断。

先从本地材料生成待标注样本，再准备首批 20 条（科研与工程各半，只取开发集，并轮流取不同信源）：

```powershell
node --env-file=.env scripts/migrate.ts
node scripts/prepare-labeling.ts
npm run review:prepare
```

同一批次重复准备会保留人工判断；来源材料变化时生成新批次。已标注样本可在页面下载，或用 `npm run review:export` 导出到忽略的 `.data/calibration/`，见 [标注与校准](docs/selection.md)。

## 检查与维护

```powershell
npm run typecheck
npm run build -w @aihot/web
node --test apps/web/tests/*.test.ts
node --env-file=.env scripts/smoke.ts --base http://localhost:3000
node --env-file=.env scripts/check-sources.ts
```

后端测试需先迁移独立的 `*_test` 数据库，设置 `DATABASE_URL` 后运行 `npm test`。进程信号测试需要 Linux，可在 Docker 或 CI 中执行；模型与第三方接口由本地假服务回答。

- 修改站点与编辑标准：`industry/`。
- 更新信源：后台管理；`sources.json` 只导入尚不存在的信源，避免覆盖人工配置。
- 重新生成品牌资源：`node scripts/rshot-brand.ts`（字体来自仓库，保留原有许可）。
- 框架架构与部署：[架构](docs/architecture.md)、[部署](docs/deploy.md)、[平台选择与费用](docs/deployment-options.md)。
- 收集待编辑材料：`node --env-file=.env scripts/collect-review.ts`，只读取公开来源，结果在 `.data/`，不会发布或调模型。
- 原项目说明：[上游 README](docs/upstream-readme.md)、[LICENSE](LICENSE)、[NOTICE](NOTICE)。内部 `@aihot/*` 包名保留以兼容框架代码。
