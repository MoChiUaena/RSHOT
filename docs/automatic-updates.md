# 本机自动更新

需要 Node.js 24.11+、已运行的开发数据库与网页，以及仓库外的模型配置。电脑和 Docker 持续运行时，后台 worker 负责采集、预筛、评分、摘要、归组与简报。

## 启动

```powershell
node --env-file=.env scripts/migrate.ts
npm run updates:check
node scripts/start-updates.ts --live --fast
```

第三条保持进程运行。`--fast` 只用于已验证支持思考开关的千问模型；其他模型省略此参数。模型密钥只传给 worker 环境，不写入代码、命令参数或运行记录。启动器仅使用本地 `_dev` 数据库，拒绝重复启动活跃 worker；网页的 `.env` 采集与模型开关可继续保持关闭。

## 默认采集限制

| 限制 | 默认值 |
|---|---:|
| 发布时间或来源更新时间范围 | 最近 48 小时，且不早于启动时设置的起点 |
| 每个信源每次接收的新资料或修订 | 2 条 |
| 全站滚动 1 小时 | 4 条 |
| 全站滚动 24 小时 | 10 条 |
| 单一信源滚动 24 小时 | 3 条 |

策略在私有数据库 `settings` 的 `collection.policy` 中，包含明确的信源名单。新增信源需核对后加入名单。通过核验的免费 X／公众号由[独立本机只读适配器](social-source-ops.md)登记为 `external`，并复用同一套事务准入和数量限制；普通付费 X、公众号入口与任意外部上报不会自动取得该通路。未设置策略的上游通用框架保留原采集行为；免费适配器及已有受限策略在缺失、停用或格式错误时都不回退到无限制采集。

Docker 的 `setup` 会运行 `scripts/prepare-collection.ts --apply`，在 worker 启动前初始化同样的采集策略与模型预算。重复运行保留已有策略与更低预算；默认安全阀关闭，模型配置通过服务器仓库外文件仅传给 worker，见 [部署说明](deploy.md)。

现有资料第一次出现在采集列表时记录来源基线，不因补到订阅正文而再次付费分析；后续实际变化可作为新修订进入限额。已接收条目的正文与摘录形成稳定指纹，标题修正沿用已知资料身份。超额条目不推进观察指纹，RSS 校验器也会暂时移除，下一轮仍可读取。

准入与处理排队在同一数据库事务内完成，全站限额由事务锁串行核验。首次启动不按历史回灌展示新资料；超过时间范围与日期缺失的材料不会进入此次自动处理。原始来源日期仍在条目中保留。

模型回执另外限制最多每分钟 20 次、每小时 60 次、滚动 24 小时 200 次；已有较低或为零的预算保留。每条资料可能调用多个步骤，归组、综述和日报也使用同一预算。这是请求次数限制，费用取决于实际模型和 token 数量。

## 状态与停止

```powershell
npm run updates:status
npm run updates:stop
```

状态命令只读取 worker 心跳、准入数、信源健康与预算，不调用模型或显示凭据。停止命令请求 worker 有序结束，网页和数据库继续运行。可以用相同启动命令恢复，已有基线、限额与回执保留。

本机可使用后台进程启动，Windows 的后台启动需加 `-WindowStyle Hidden`，日志放在忽略的 `.data/logs/`。本启动器的运行记录为 `.data/updates-worker.json`，其中只有进程信息、限制和参数模式，没有密钥。

Windows 可安装当前用户登录后的本机恢复任务：

```powershell
pwsh -NoProfile -File scripts/prepare-resume-model.ps1
pwsh -NoProfile -File scripts/prepare-resume-model.ps1 -Apply
pwsh -NoProfile -File scripts/install-resume-task.ps1
pwsh -NoProfile -File scripts/install-resume-task.ps1 -Apply
```

登录任务的进程看不到原 AppData 模型目录，因此准备工具会把同一配置复制到工作区内、**Git 仓库外**的 `RSHOT-private/models.env`，并将目录与文件权限限制给当前用户及 SYSTEM；任务只保存该文件路径，不保存密钥内容。更新原 AppData 中的 API 配置后，重新运行 `prepare-resume-model.ps1 -Apply` 同步副本。

任务仅核对并恢复 `rshot-dev-db`、属于本项目的 3000/3001 端口服务，以及有采集与模型调用限额的 worker。已运行的服务不会重复启动；端口属于其他进程或 worker 状态不明时停止并在 `.data/logs/local-resume-events.log` 记录。任务运行依赖 Docker Desktop 已在用户登录后启动；它会在失败时按计划任务配置重试。本地服务在电脑关机和用户退出登录期间仍不能运行，Pages 保留最后一次公开快照。

需要持续暂停采集时，先运行 `Disable-ScheduledTask -TaskName RSHOT-Resume-Local`，再运行 `npm run updates:stop`。只停止当前 worker，下一次登录仍会自动恢复。重新启用登录恢复可运行 `Enable-ScheduledTask -TaskName RSHOT-Resume-Local`；每日公开快照由独立的 `RSHOT-Publish-Preview` 任务控制。

## 简报

日报在北京时间 08:00 生成上一日 08:00 到当日 08:00 的内容；周报与月报保留框架原计划。自动任务跳过已存在的简报，保留编辑版；主动重写需单独明确调用。

下一期的当前草稿可在本地验证：

```powershell
node scripts/run-with-model.ts scripts/preview-report.ts --live --fast
```

默认选择下一次应出的日报，统计截至当前时刻；草稿只保存到 `.data/reports/preview-日期.json`，不进入公开读取层。需要特定日期可添加 `--date YYYY-MM-DD`。公开日报保持完整统计窗口，未到截止时间不会由自动任务提前发布。

公网常驻部署还需要服务器、域名及运营信息确认；本机运行不等于已经部署到公网。
