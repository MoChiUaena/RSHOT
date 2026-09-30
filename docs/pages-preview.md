# 免费 GitHub Pages 预览

公开只读测试地址：<https://mochiuaena.github.io/RSHOT/>。

GitHub Pages 负责免费地址、HTTPS 与静态网页；当前完整 RSHOT 的采集、模型处理、数据库和后台管理仍在本机运行。电脑关机后 Pages 仍可浏览上次导出的内容，新增内容要等再次导出和推送。

## 预览包含什么

- 当前全部公开精选与最近 7 天公开动态，保留摘要、分类、标签、原文日期与来源链接。
- 标题、摘要、信源与标签的浏览器内搜索。
- 已发布且包含公开条目的日报、周报与月度观察，以及信源列表。
- 桌面沿用原站的左侧导航、配色和日期时间线；手机沿用底部导航。
- 主题页、公开热点快照、关于与更新日志；收藏和外观偏好仅存于当前浏览器。
- 明确显示导出时间与“只读测试预览”。

这是免费测试入口。反馈页链接到项目 GitHub Issues；Agent 接入页提供公开 JSON 快照，并说明后端接口的范围。后台登录、标注、原站反馈表单、实时 API、RSS 和 MCP 仍属于本机或完整部署版本。正式上线前的运营信息与条款仍按项目 `AGENTS.md` 由运营者确认。

## 更新公开内容

本机网页已经运行时：

```powershell
npm run preview:export
npm run preview:export -- --apply
npm run preview:build
npm run preview:serve
npm run check:secrets
```

第一条只显示计划。`preview:serve` 在本机的 `http://127.0.0.1:3040/RSHOT/` 预览构建结果，按 Ctrl+C 停止后可继续执行检查。实际导出通过匿名 HTTP 读取现有公共发布层，不读数据库、不登录管理员，也不调用模型。只写入允许的公开字段，排除正文、原始数据、运行设置、私人标注、图片代理签名及本机链接。已撤下资料不会导入。来源 URL 带凭据、敏感查询参数或内网地址时不导出链接。

公开数据为 `industry/preview/snapshot.json`。脚本写入前检查已知本地密钥及常见凭据格式；提交前 hooks、推送前 hooks 和 CI 继续检查。模型文件、`.env`、`.data/` 与数据库导出保持私有；GitHub Actions **不需要模型密钥或数据库密码**。

### 本机每日自动发布

Windows 用户可在已配置本机 worker、数据库和网页服务后，安装当前用户的计划任务：

```powershell
npm run preview:publish
pwsh -NoProfile -File scripts/install-preview-task.ps1
pwsh -NoProfile -File scripts/install-preview-task.ps1 -Apply
```

第一条与第二条只检查、显示计划，不推送。任务每天北京时间 08:30 启动；若当期日报还没生成，会等待至多 150 分钟。它要求电脑运行、用户已登录、本机服务可用，且当前 Git 分支跟踪 `origin/main`。如果电脑关机或用户退出登录，Pages 保留上次快照；重新登录后，Windows 会尽量补运行错过的任务，但本机 worker 仍需按 [自动更新说明](automatic-updates.md) 恢复。

任务调用 Windows 自带的 PowerShell，并仅对这个任务进程使用 `RemoteSigned` 来运行本仓库的本地脚本；不会修改系统或用户的执行策略。

发布器先确认仓库干净且与远端 `main` 完全一致，再从匿名公开接口导出。只有公开内容实际变化时才暂存 `industry/preview/snapshot.json`，运行暂存内容的密钥检查，创建提交并正常推送；它不会覆盖其他修改、强推或把模型文件放进 Git。如果有人编辑工作区、报告未完成、密钥检查失败或推送失败，任务会停止并在忽略的 `.data/preview-publication/` 记录阶段与原因。若只有导出时间改变，不创建提交。部署完成还会确认 Pages workflow 对应提交成功。

在本机的 `127.0.0.1:7897` 代理可用时，发布器使用它连接 GitHub；否则尝试直接连接。代理只用于 Git，不用于模型调用，也不携带密钥参数。

同目录的 `monitor/YYYY-MM-DD.json` 每天记录 worker 心跳、14 个信源的读取健康、准入数量、当期日报条数，以及统计窗口内公开条目的来源、摘要与精选依据，供一周人工复核。单独变化的导出时间或空热点榜计算时间不会触发重复提交。查看任务和最新结果：

```powershell
Get-ScheduledTask -TaskName RSHOT-Publish-Preview
Get-Content .data/preview-publication/latest.json
```

需要停用时使用 `Disable-ScheduledTask -TaskName RSHOT-Publish-Preview`；不会删除已发布网页或本机记录。

确认导出的内容后，将公开快照和代码提交并推送 `main`，`Preview Pages` workflow 构建 `dist/preview` 并发布。首次在仓库 Settings → Pages 将 Source 设为 GitHub Actions。此仓库已由维护流程设置；无需购买域名。

预览资源均使用相对路径，页面导航使用 hash 路由，支持 `/RSHOT/` 项目子路径。浏览器直接刷新日报和条目地址也会读取同一个入口。

## 其他免费完整部署方案

Oracle Cloud Always Free 有机会运行完整后台，但需要用户注册、验证及申请到合适的免费实例。Render 免费服务会休眠，免费 PostgreSQL 30 天到期，适合临时验证。已核对的限制和官方链接见 [部署平台比较](deployment-options.md)。
