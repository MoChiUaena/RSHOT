# 免费社交来源的本机读取

公共 `industry/social-sources.json` 只是批准的十二个候选来源。身份确认、登录材料和启用记录放在 Git 目录之外。脚本只读取 X 原创帖和本机 WeRSS 的指定公众号 RSS，不访问书架、书籍、个人划线，也不自动发现浏览器 Cookie。

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

twitter-cli 0.8.5 的实际 JSON 是 `{ok:true,schema_version:1,data:[...]}`；读取器严格校验后解包 `data`，也兼容裸数组。失败包装、未知版本及混入错误字段均拒绝。在 Windows 中文 venv 路径下，curl_cffi 会出现 curl77；准备器从该 venv 的 `Lib/site-packages/certifi/cacert.pem` 复制公开 CA 到固定 `os.homedir()/.rshot-social-public/cacert.pem`，验证证书及 ASCII 路径，拒绝 symlink/junction。CA 不含密钥，更新不会触及认证文件。读取器校验 CA 后同时设置 `CURL_CA_BUNDLE` 和 `SSL_CERT_FILE`，保留 TLS 校验。有效来源缺少可用 CA 时为 `needs-dependency`。X 可使用固定已有本机代理 `http://127.0.0.1:7897`：仅端口可连接时传入 `TWITTER_PROXY`，不接受 profile 中的代理 URL，不继承任意代理环境变量。

WeRSS 服务固定为 `http://127.0.0.1:8041`。读取器向 `/api/v1/wx/auth/login` POST JSON `username`/`password`，只在内存中使用 `data.access_token`（兼容顶层 `access_token`）。随后 GET `/rss/<feedId>`，token 只放在 Authorization 请求头。`feedId` 必须匹配 `MP_WXS_` 加数字，禁止 URL、任意路径和查询。两种请求均拒绝重定向、超时 10 秒、流式限制 2 MiB。RSS 的频道名称和公众号原文地址由统一解析器校验。本机实际版本的登录和 RSS 路由须在部署时验证。

确认账号身份及可读依赖后，把相应条目标记为 `verified:true`；登记前再填入 ISO 格式 `verifiedAt`。默认 `node scripts/free-social.ts` 是 dry-run：只读样本，不初始化数据库，也不写运行状态。没有任何已核验来源时不调用网络或子进程。`--check` 输出来源状态、合格数量、标题、日期和原文公开链接，省略正文与会话资料。来源失败互相隔离。

显式登记使用 `npm run social:register`。它要求该次实际读取有非空合格样本，且私有条目已核验并有 `verifiedAt`。数据库必须已有有效且 enabled 的 `collection.policy`；登记器不会建立或复活策略。登记使用与入库相同的事务咨询锁，只新增目录批准的 external/editorial 来源，`config={}`，沿用目录 tier/ownerEntityId，默认只公开摘要和原文链接。已有人工来源行不会覆盖；不兼容配置拒绝登记。来源 ID 追加到原策略，预算和窗口保持原值。

显式入库使用 `npm run social:apply`。仅已核验且读取成功的来源进入现有受控 admission；来源和策略还须在数据库启用。失败不会删除已有文章。适配器关闭模型、通用采集和付费推送开关，只排入现有 worker 处理队列。处理队列的实际运行由既有 worker 管理。只有 apply/register 在被忽略的 `.data/social-source-runs/` 写来源健康、检查日期、最近成功日期和数量。

安装计划任务前先 `--check` 验证实际读取，再运行 `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/install-social-task.ps1` 预览，添加 `-Apply` 安装。依赖、凭据和至少一个已核验来源缺一都会拒绝安装。任务名 `RSHOT-Collect-Social`，每天本机时间 06:30、18:30，当前用户登录时 Interactive/Limited/Hidden 执行 Windows PowerShell 5.1 wrapper。重复安装匹配原配置时不修改；同名任务 owner/action/时间或设置不匹配时拒绝覆盖。参数仅含脚本与可选 profile 路径。wrapper 并发排空 stdout/stderr、保留 Node 退出码，适配器日志只含安全结果。

边界测试：`node --test tests/free-social-reader.test.ts`，默认不使用数据库或外部服务。可选登记/入库测试必须显式 `FREE_SOCIAL_READER_DB_TEST=true`，且仅接受一次性本机 `rshot_social_test`；测试只用临时凭据、真实受控子进程、本机 HTTP fake server。fixture transport 仅在测试环境且临时目录内生效，生产 endpoint 不接受配置。
