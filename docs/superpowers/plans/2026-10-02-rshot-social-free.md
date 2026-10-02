# RSHOT 免费社交信源接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把用户已确认的 6 个 X 账号、6 个公众号中通过读取核验的来源接入本机受限采集，授权信息保存在 Git 仓库外。

**Architecture:** 独立本地适配器读取 twitter-cli 0.8.5 JSON 与本机 WeRSS RSS；验证发布者、公开原文地址、时间与内容后，由后端复用 `storeControlled` 写入并排队。来源使用 `external` 类型，现有 worker 不会把它们当成付费 X／公众号任务；浏览器与订阅服务授权独立于代码和 Pages。

**Tech Stack:** Node.js 24.11+、TypeScript、Zod、现有 PostgreSQL 与 RSS 解析依赖、Python 3.12/twitter-cli 0.8.5、本机 Docker/WeRSS。

**Spec:** `docs/social-source-plan.md`（名单与免费方式已由使用者明确确认）。

## Global Constraints

- 只有用户确认且通过近期原文读取核验的来源启用，账号 ID 不猜测。
- 凭据、Cookie、授权数据库和运行记录都在 Git 仓库外或忽略目录；日志不包含凭据或原始错误正文。
- 不读取私信、个人书籍、划线、私人标注；不发帖、关注、点赞，不订购付费采集接口。
- 延续近 48 小时、每轮 2 条、每小时 4 条、滚动 24 小时 10 条、单源 3 条的现有准入限制，不提高模型预算。
- 新资料必须走 `storeControlled` 的身份判重、事务限额与任务排队，停用/缺失策略不能回退到无上限导入。
- 不全局打开 `ALLOW_PRIVATE_NETWORK_FETCH`，本机服务请求使用固定回环地址、固定端口、认证和无重定向读取。
- 保留来源时间与完整可核验贡献材料，公开出口仍只显示摘要和原文链接；公众号全文不公开转载。
- X 转发不作为本人原创；同机构跨平台重复稿件不重复计作独立热度来源。
- 测试用本地假输入与独立 `_test`/`_ci` 数据库，不访问外部服务或模型。

## Task 1: 规范化与受限导入

**Files:** `packages/backend/src/sources/free-social.ts`、`industry/social-sources.json`、`tests/free-social.test.ts`。

**Interfaces:**

```ts
export interface FreeSocialSource {
  id: string; name: string; platform: "x" | "wechat";
  handle?: string; aliases: string[]; tier: "T1_5" | "T2";
  ownerEntityId: string | null;
}
export function approvedSocialSources(): FreeSocialSource[];
export function normalizeXPosts(input: unknown, source: FreeSocialSource, now?: Date): Candidate[];
export function normalizeWechatFeed(xml: string, source: FreeSocialSource, now?: Date): Candidate[];
export async function ingestFreeSocial(sourceId: string, candidates: Candidate[]): Promise<AdmissionSummary>;
```

- [ ] 写失败测试：X 序列化为数组，字段 `id,text,author.screenName,author.name,createdAtISO,isRetweet,lang`；匹配指定作者，过滤转发、过期/未来/无日期/重复帖、含凭据 URL，以及不完整材料。
- [ ] 写失败测试：公众号 RSS 的 channel title 匹配 name/aliases，只接受可追溯的微信原文或明确的微信读书公众号文章 URL；拒绝普通书籍/划线/其它域名/错源、畸形 XML 和超大输入。
- [ ] 写数据库失败测试：只接受清单内启用的 external/editorial 来源，且必须在活动 collection.policy 名单内；现有限额与去重保持，策略停用时拒绝写入，不能触发外部模型。
- [ ] 实现上面接口。动态导入数据库/准入模块，使纯规范化测试不需要数据库连接。
- [ ] `node --test tests/free-social.test.ts`，再使用独立测试库验证写入、配额和禁用分支；先观察失败再实现。
- [ ] 自审、提交本任务文件；报告写入本计划 SDD workspace 的 task-1-report.md。由独立审查核对规格和代码质量。

**Catalog IDs:** `free-x-usgs-landsat` / `USGSLandsat`、`free-x-esa-eo` / `ESA_EO`、`free-x-copernicus-land` / `CopernicusLand`、`free-x-copernicus-ems` / `CopernicusEMS`、`free-x-copernicus-eu` / `CopernicusEU`、`free-x-giswqs` / `giswqs`；公众号为 `free-mp-aircas`、`free-mp-ygxb`、`free-mp-whu-rsgis`、`free-mp-liesmars`、`free-mp-gis-frontier`、`free-mp-xuxiaoyang`。公众号名称/别名从 spec 中取，只作为核验候选，不作为身份已验证的断言。

## Task 2: 本机读取、私有配置与运行入口

**Files:** `scripts/lib/free-social-reader.ts`、`scripts/free-social.ts`、`scripts/prepare-social.ps1`、`scripts/install-social-task.ps1`、`scripts/run-social-task.ps1`、`tests/free-social-reader.test.ts`、`docs/social-source-plan.md`。

**Consumes:** Task 1 全部接口。**Produces:** 默认 dry-run、不写数据库；`--apply` 导入已核验账号，`--register` 只登记通过读取核验的账号并追加其准入 ID，`--check` 只输出安全健康摘要。

- [ ] 固定私有配置路径 `<RSHOT-private>/social/profiles.json`；配置只含启用/已核验来源、固定 WeRSS feed ID 与认证文件路径。拒绝仓库内凭据路径、任意执行命令/任意 URL、未知账号 ID。
- [ ] X 用已安装的私有 venv 执行 `twitter user-posts HANDLE -n 5 --json`；Cookie 仅传子进程环境，不在参数或日志中。编码固定 UTF-8，子进程限时 60 秒、限制输出大小；错误只记分类/退出码。
- [ ] WeRSS 只请求固定 `http://127.0.0.1:8041` 的已登记 feed 路径，不允许重定向；只取指定公众号的 RSS，不读书架书籍或划线。逐源隔离错误，失败不覆盖上一份有效资料。
- [ ] 准备工具仅生成私有目录/空配置和登录说明，权限仅当前用户及 SYSTEM。计划任务仅保存公开脚本与私有路径，每天 06:30/18:30 本机低频运行、用户已登录时执行，重复安装验证所有权。
- [ ] 用真实子进程/本地假 HTTP 服务验证白名单、时间、字段过滤、凭据不出现在错误与公开样本中、只读默认，以及单源失败隔离。
- [ ] 自审、提交与独立审查；准备工具/安装器不自动把未核验候选启用。

## Task 3: 实机核验、接入和发布

**Files:** 私有环境与运行记录（不提交）、文档更新、现有公开快照。

- [ ] 部署固定版本/提交的 WeRSS 服务，只监听本机 8041；独立私有数据目录，随机本地密钥，关闭默认密集采集、外部通知和普通书籍采集。
- [ ] 人类亲自登录 X、授权本地微信读书采集；网页登录状态与程序授权分别核验，不把网页已登录当成适配器可用。无法共享登录时给出明确的本地授权步骤，不在聊天中索要 Cookie。
- [ ] 每个候选最多试读 5 条，核对账号身份、日期、正文、原始链接与原始出处；验证失败保持候选/暂停，并记录具体状态。
- [ ] 启用通过者，加入 collection.policy 同一限额；创建/测试本机社交更新任务，确认读者访问网页不会调用采集或模型。
- [ ] 按 AGENTS.md 跑 typecheck、独立 Linux 后端测试、web build/test、smoke、密钥检查、独立最终审查。
- [ ] 将完整代码与非敏感说明同步 GitHub，使用现有预览发布任务确认部署；复核自动化按实际启用信源数更新。

## 已核实的平台限制

- 当前 WeRSS 微信读书公众号模式采用 cover 增量接口，只能取最新一篇，不能回补完整历史列表；公众号一日多篇可能漏读，需在试抓报告说明。
- 浏览器内登录不能自动证明 twitter-cli 或隔离订阅服务已获得授权。
- 应用的原生 worktree 工具针对父仓库，无法定位 RSHOT 提交；使用 RSHOT 自己的 Git 创建 `codex/social-free` 工作区，原有服务不改目录。
