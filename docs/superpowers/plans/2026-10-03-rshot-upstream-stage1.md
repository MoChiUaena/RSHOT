# RSHOT 上游第一批修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移植小范围采集、入库和依赖修复，并证明原有 RSHOT 功能仍可用。

**Architecture:** 保留 RSHOT 当前模块和所有本地扩展，将固定上游中的具体修复移植到对应函数。先移植回归测试，在旧源码上看到预期失败，再改实现；每项独立提交和审查。

**Tech Stack:** Node.js 24.18、TypeScript、PostgreSQL 17、Fastify、fast-xml-parser、Docker、Windows PowerShell。

**Spec:** `docs/superpowers/specs/2026-10-03-rshot-upstream-upgrade.md`

## Global Constraints

- 基线 `dfba98f3366283ee15d228b6a8d8fb2d0d98143d`，上游 `3343fe2b20db4be7269113752d82d3992fc52b6b`；不移动目标。
- 保留行业包、已核验来源/停用状态、采集准入/模型预算、免费 X 读取、人工标注/修订、10:30 任务、Pages 和秘密保护。
- 第一批不执行生产迁移、不更换运行凭据、不发起付费模型请求。测试使用关闭的安全阀、独立 `_test`/`_ci` 库和本地 HTTP 桩。
- 不提交 `.env`、密钥、`.data/`、授权、标注或本地监测记录。工作在独立 Git 工作树；运行目录只在验证通过后集成。

### Task 1: 基线与保留功能验证

**Files:** 现有 `tests/free-social.test.ts`、`tests/free-social-reader.test.ts`、`tests/preview-publication-recovery.test.ts`、`tests/preview-export.test.ts`。

**Interfaces:** 不改变接口；产出基线测试和构建证据。

- [ ] 安装锁定依赖：`npm ci --no-audit --no-fund`。
- [ ] 跑 `npm run typecheck`、Windows 三个社交/发布测试；运行现有快照 schema/导出测试。
- [ ] 准备隔离 PostgreSQL 和 Linux Node 24 测试环境，模型与外部采集全部关闭。基线完整测试也可由同一基线提交已通过的 GitHub Check 辅以本地保留测试确认。
- [ ] 保存基线 SHA、环境、命令及结果到该计划的私有 SDD ledger。

### Task 2: Atom 与网页日期修复

**Files:** `packages/backend/src/sources/rss.ts`、`packages/backend/src/sources/web-list.ts`；新增 `tests/rss-xhtml.test.ts`、`tests/rss-links.test.ts`、`tests/web-list-date.test.ts`。

**Interfaces:** 保持 `fetchRss(source, opts)` 返回结构和 `parseLooseDate(value, utcOffset)`；保留 RSHOT 已有摘录、关键词、身份和日期策略。

- [ ] 从固定上游导入上述三个测试文件；必要时只适配 RSHOT 已有 SourceRow/配置，不削弱断言。
- [ ] 在旧源码上跑新测试，记录 XHTML 文本、XML Base 和 `TZ=UTC` 日期的预期失败。
- [ ] 用上游实现修复 XHTML stopNodes、相对 Atom 链接基准和无时区日期处理；保留本地新增逻辑。
- [ ] 验证的字面结果包括：

```ts
assert.equal(items[0].title, 'New research result');
assert.equal(items[0].excerpt, 'First important result, then another.');
assert.equal(parseLooseDate('2026-09-26 10:00', '+08:00').toISOString(), '2026-09-26T02:00:00.000Z');
assert.equal(parseLooseDate('2026-09-26 10:00', '-07:00').toISOString(), '2026-09-26T17:00:00.000Z');
```

- [ ] 在 UTC 和 Asia/Shanghai 两种环境跑日期测试，再跑既有 sources/社交解析测试。
- [ ] 只暂存任务文件，提交修复，交付 red/green 命令、结果与 SHA 范围供独立审查。

### Task 3: 通用入库与 X URL 身份修复

**Files:** `packages/backend/src/ingest/items.ts`、`packages/backend/src/lib/url.ts`；新增/适配 `tests/ingest.test.ts`、`tests/url-identity.test.ts`，保留 `tests/free-social.test.ts`。

**Interfaces:** 保持成功响应 `{ok:true, created:number}`；不改变免费读取器身份校验和受限准入。

- [ ] 从固定上游导入 route-level 入库和 URL 测试，按 RSHOT 独立测试库及 source/config 准备规则适配。
- [ ] 在旧实现看到：非对象正文/后续非对象条目未在写库前拒绝、暂停来源仍写入、伪装主机产生 tweet ID 的预期失败。
- [ ] 实现整个批次的对象结构预检；暂停来源 INSERT conflict 返回空后报 409；用 URL 协议/主机/path 校验 tweet 身份。
- [ ] 验证字面身份结果：

```ts
assert.equal(tweetIdFromUrl('https://x.com/USGSLandsat/status/123'), '123');
assert.equal(tweetIdFromUrl('https://evil.example/x.com/USGSLandsat/status/123'), null);
assert.equal(tweetIdFromUrl('https://x.com.evil.example/USGSLandsat/status/123'), null);
```

- [ ] 真实路由测试断言 HTTP 400/409 且源/文章无部分写入；有效批次、缺少 URL/title 的既有 skip 和去重继续成功。
- [ ] 跑新测试及免费社交回归，独立提交和审查。

### Task 4: fflate 补丁与集成验证

**Files:** `package.json`、`package-lock.json`。

**Interfaces:** 加入 `overrides.fflate = '0.7.5'`，保留所有 RSHOT scripts/workspaces。

- [ ] 应用上游依赖 override，用 npm 更新锁文件并检查差异只涉及该依赖的解析。
- [ ] 确认 `npm ls fflate` 无旧版本，跑网页与 Pages 构建，验证图像处理相关测试。
- [ ] 跑完整 Linux 后端测试、类型检查、网页测试、建站 smoke，以及 Windows 社交/定时脚本回归。
- [ ] 验证公开快照、修正过的文章/日报内容和来源配置保持完整；用秘密检查校验将提交的文件。
- [ ] 独立提交，经整个第一批审查后再集成。后续批次依照主规格继续，不把第一批完成当作整个升级完成。
