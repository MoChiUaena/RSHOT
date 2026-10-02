# RSHOT 社交信源后续核验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复公众号刷新完成和原文日期证明，并仅启用通过真实近期样本核验的已批准来源。
**Architecture:** 固定 loopback WeRSS 读取器验证成功同步标记后再读 RSS；候选必须再由固定 by_article 入口证明发布账号、原始标题、原始日期和可读正文。多篇列表在现有授权下失败，保留待实测状态，不引入默认书架采集。
**Tech Stack:** Node.js 24 TypeScript、node:test、本机 WeRSS、已有 Windows 计划任务。
**Spec:** 用户已批准的 12 个候选来源和 docs/social-source-ops.md。

## Global Constraints

- 无新增付费服务或模型预算；48h、2/run、4/hour、10/rolling-day、3/source/day，模型 20/min、60/hour、200/day 保留。
- 只读指定公众号公开文章；不读书架、笔记、阅读进度；不自动订阅；认证全部留在仓库外。
- 原文核验固定 localhost 路径、header token、无重定向、2 MiB 响应上限；最多 3 条/source，单条 45 秒，总 120 秒。
- 公众只看摘要与原文链接；测试不调用外部 API。

## Tasks

- [x] 证明 update code0 异步以及缓存竞态；TDD 修复 sync_time 轮询及 is_update=true。
- [x] 实测文章列表返回 -2012；封面接口成功，列表多篇未通过。不得宣称已完成多篇覆盖。
- [x] 对既有两公众号与候选核对原文日期；发现 RSS 使用采集日期。
- [ ] 在 reader 测试复现旧文被当新文的问题，观察失败。
- [ ] 新建 scripts/lib/wechat-original.ts，复用统一 normalizer；严格验证 mp_id、账号、标题、秒级日期、fetch_error、正文。
- [ ] 修改 reader，原文证明通过后才使用候选；失败清空并隔离来源；过期原文为空。
- [ ] 离线回归：原始日期、正文、身份、缺失/未来/畸形值、超限、token 边界及 X 隔离。
- [ ] 记录各来源结果与免费多篇限制，更新操作文档。
- [ ] 跑 AGENTS.md 必需 gates、独立 review、secret 检查；合并、推送、验证 CI/Pages；安全部署主 checkout。
