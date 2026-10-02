# 免费社交来源的本机读取

公共 `industry/social-sources.json` 只是批准的十二个候选来源。身份确认、登录材料和启用记录放在 Git 目录之外。当前 RSHOT 仅运行 X 原创帖采集。2026 年 10 月 2 日用户决定停止微信读书路线，全部依赖它的公众号采集已停用：私有 profile 的公众号条目未启用且不再关联 werss，数据库来源与准入清单同步停用，本机 WeRSS 服务停止且不自动重启。不要重新生成微信读书二维码、读取 Cookie/票据或重启该服务。

下文的 WeRSS 接口与验证边界保留为历史实验记录，不是当前 RSHOT 接入建议。后续公众号方案通过公开原文与机构出处另行核验。

在主 checkout 运行 `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/prepare-social.ps1`，默认准备相邻 `RSHOT-private/social/`。隔离 worktree 应显式传 `-PrivateRoot` 的外部绝对路径；CLI 与安装器用 `--profiles` / `-Profiles` 指定外部 `profiles.json`。准备器创建空 `collectors.env`、空 `werss.env` 和所有来源 `verified:false` 的配置。已有文件字节保留，目录和文件 ACL 仅授予当前用户和 SYSTEM。

私有配置版本为 1。`twitter.executable` 必须是私有根下 `twitter-venv/Scripts/twitter.exe`（非 Windows 为 `twitter-venv/bin/twitter`）；任意其他可执行程序、命令、符号链接和 junction 均被拒绝。认证文件必须与 profile 同目录，分别命名为 `collectors.env` 和 `werss.env`。没有服务 URL 配置项。

```json
{
  "version": 1,
  "twitter": {
    "executable": "C:/private/RSHOT-private/twitter-venv/Scripts/twitter.exe",
    "credentialsFile": "C:/private/RSHOT-private/social/collectors.env"
  },
  "werss": { "credentialsFile": "C:/private/RSHOT-private/social/werss.env" },
  "sources": [
    { "sourceId": "free-x-giswqs", "verified": false },
    { "sourceId": "free-mp-gis-frontier", "verified": false, "feedId": "MP_WXS_123" }
  ]
}
```

用户只在私有 `collectors.env` 填写 `TWITTER_AUTH_TOKEN`、`TWITTER_CT0`；只在私有 `werss.env` 填写本机服务的 `USERNAME`、`PASSWORD`。不要把值放到命令行、聊天、公开配置或 Git。X 子进程只收到必要的运行环境和这两项显式认证，固定执行 `user-posts <目录内handle> -n 5 --json`。不完整认证产生 `needs-auth`，不会启动子进程；超时 60 秒、输出上限 2 MiB，stderr 直接丢弃。

twitter-cli 0.8.5 的实际 JSON 是 `{ok:true,schema_version:"1",data:[...]}`；读取器严格校验后解包 `data`，也兼容数字 `1` 和裸数组。失败包装、未知版本及混入错误字段均拒绝。在 Windows 中文 venv 路径下，curl_cffi 会出现 curl77；准备器从该 venv 的 `Lib/site-packages/certifi/cacert.pem` 复制公开 CA 到固定 `os.homedir()/.rshot-social-public/cacert.pem`，验证证书及 ASCII 路径，拒绝 symlink/junction。CA 不含密钥，更新不会触及认证文件。读取器校验 CA 后同时设置 `CURL_CA_BUNDLE` 和 `SSL_CERT_FILE`，保留 TLS 校验。有效来源缺少可用 CA 时为 `needs-dependency`。X 可使用固定已有本机代理 `http://127.0.0.1:7897`：仅端口可连接时传入 `TWITTER_PROXY`，不接受 profile 中的代理 URL，不继承任意代理环境变量。

## 历史实验：WeRSS 读取协议（当前停用）

WeRSS 服务曾固定为 `http://127.0.0.1:8041`。读取器向 `/api/v1/wx/auth/login` POST `application/x-www-form-urlencoded` 的 `username`/`password` 表单，只在内存中使用 `data.access_token`（兼容顶层 `access_token`）；token 只放在 Authorization 请求头。`feedId` 必须匹配 `MP_WXS_` 加数字，禁止 URL、任意路径和查询。先 GET `/api/v1/wx/mps/<feedId>` 验证账号名称、ID 和数字 `sync_time`，再触发 `/api/v1/wx/mps/update/<feedId>?start_page=0&end_page=1`。`code:0` 只表示后台任务启动：在总计 60 秒内每秒核对同步标记，必须比基线增大且不早于本次触发，才读取 `/rss/<feedId>?is_update=true`，避免缓存竞态。`code:40402` 仅在已证实最近 60 秒有成功标记且仍有合格近期条目时继续。超时或异常清空本次结果，不能拿缓存当作刷新完成。

当前微信读书 cover 模式把采集时刻写成 RSS 日期，不能直接证明 48 小时资格。RSS 仅提供经校验的频道身份、标题和微信原文入口；空正文和采集日期不承担内容或时效证明。每个来源至多核验 3 条：向固定 `/api/v1/wx/mps/by_article?url=<已验证的微信原文>` POST，无请求正文，header token；核对原文 `mp_id`、批准名称/别名、标题、秒级发布日期、无抓取错误及完整正文。核验通过后使用原文日期和原文正文，标记 `dateProvenance:wechat-original`；旧于 48 小时的原文为空，其他核验失败拒收。原文解析器缺日期时也可能返回当前时间，因此落在本次原文请求开始前 60 秒以来的日期一律拒绝；真实刚发布内容在后续运行重新核验。每条 45 秒、原文证明总计 120 秒；所有请求拒绝重定向，流式限制 2 MiB，不记录原始错误。

保留 WeRSS 默认高频 JOB 关闭、每天两次计划任务及原有 admission/模型额度。当前通道只能保证可读 cover，不保证公众号所有当天文章；文章列表需有效微信读书授权再实测。只调用已批准公众号公开文章与身份接口，不读书架、阅读进度、划线或笔记，不自动订阅。各候选核验结果见 [社交信源核验](social-source-verification.md)。

## 当前运行：X 登记、入库与计划任务

仅对已批准的 X 账号确认身份及可读依赖后，把相应条目标记为 `verified:true`；登记前再填入 ISO 格式 `verifiedAt`。默认 `node scripts/free-social.ts` 是 dry-run：只读样本，不初始化数据库，也不写运行状态。没有任何已核验来源时不调用网络或子进程。`--check` 输出来源状态、合格数量、标题、日期和原文公开链接，省略正文与会话资料。来源失败互相隔离。

显式登记使用 `npm run social:register`。它要求该次实际读取有非空合格样本，且私有条目已核验并有 `verifiedAt`。数据库必须已有有效且 enabled 的 `collection.policy`；登记器不会建立或复活策略。登记使用与入库相同的事务咨询锁，只新增目录批准的 external/editorial 来源，`config={}`，沿用目录 tier/ownerEntityId，默认只公开摘要和原文链接。已有人工来源行不会覆盖；不兼容配置拒绝登记。来源 ID 追加到原策略，预算和窗口保持原值。

显式入库使用 `npm run social:apply`。仅已核验且读取成功的来源进入现有受控 admission；来源和策略还须在数据库启用。失败不会删除已有文章。适配器关闭模型、通用采集和付费推送开关，只排入现有 worker 处理队列。处理队列的实际运行由既有 worker 管理。只有 apply/register 在被忽略的 `.data/social-source-runs/` 写来源健康、检查日期、最近成功日期和数量。

安装计划任务前先 `--check` 验证实际读取，再运行 `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/install-social-task.ps1` 预览，添加 `-Apply` 安装。依赖、凭据和至少一个已核验来源缺一都会拒绝安装。任务名 `RSHOT-Collect-Social`，每天本机时间 10:30（每天一次），当前用户登录时 Interactive/Limited/Hidden 执行 Windows PowerShell 5.1 wrapper。重复安装匹配原配置时不修改；同名任务 owner/action/时间或设置不匹配时拒绝覆盖。参数仅含脚本与可选 profile 路径。wrapper 并发排空 stdout/stderr、保留 Node 退出码；日志只保存固定状态、退出码及两条流的字节数，不保存原始输出或错误正文。

边界测试：`node --test tests/free-social-reader.test.ts`，默认不使用数据库或外部服务。可选登记/入库测试必须显式 `FREE_SOCIAL_READER_DB_TEST=true`，且仅接受一次性本机 `rshot_social_test`；测试只用临时凭据、真实受控子进程、本机 HTTP fake server。fixture transport 仅在测试环境且临时目录内生效，生产 endpoint 不接受配置。

本机 WeRSS 的扫码凭据验证已改为只访问已批准“遥感学报”的公开文章列表，不调用默认的 `/web/shelf/sync`。该限制仅在当前本机服务中应用；重新创建或更新上游容器后，应重新核对扫码 verifier，不能使用书架/笔记接口验证 RSHOT 的公众号授权。登录与文章列表授权是独立的实测门槛；扫码成功不能代替指定公众号列表读取成功。
