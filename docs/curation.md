# 编辑包与离线导入

首批编辑包：`industry/curation/2026-09-29.json`。资料来自真实公开来源，由助手读取并整理中文标题和摘要，供使用者复核。它是一次有日期的内容快照，不表示站点已经自动更新。

## 导入

先迁移数据库并运行 `scripts/seed.ts`，关闭 `COLLECT_ENABLED` 与 `MODEL_CALLS_ENABLED`。

```bash
node --env-file=.env scripts/seed-curated.ts
node --env-file=.env scripts/seed-curated.ts --apply
```

第一条只检查结构并显示数量；第二条导入。Docker 中可执行 `docker compose exec -T api node scripts/seed-curated.ts --apply`。

## 内容口径

- 原标题、原文地址和带时区的发布日期保留。
- `materialScope` 区分摘要、原文与订阅材料；`publicationStage` 区分预印本、正式发表、公告和版本发布。
- 分数为空。维护性质的版本动态可以不进入精选，仍可在全部动态中阅读。
- 公司与机构主题只收实际主体；方向主题使用明确标签，不用宽泛关键词补满栏目。
- 历史回灌按原始日期显示，并关闭新内容推送。
- 日报使用北京时间前一天08:00到当天08:00的窗口；周报仅覆盖完整周；本月观察写明截至日期。
- 简报从同一批公开条目生成，原文入口和撤回规则沿用公共读取层。

## 重复导入与已有内容

相同URL沿用资料身份，相同编辑结果不会再写一条分析。编辑包不会覆盖已产生的模型判断或后台人工覆盖设置；也不会覆盖其他编辑包、模型或外部导入的简报。

## 更新编辑包

复制现有格式，新条目保持唯一 key 和 URL，按现有分类、标签、主体词表填写；未知开源状态、指标和实验细节不补写。`reviewedAt` 不早于任何条目发布日期。

```bash
node --env-file=.env scripts/seed-curated.ts --file industry/curation/你的编辑包.json
node --env-file=.env scripts/seed-curated.ts --file industry/curation/你的编辑包.json --apply
```

自动评分门槛仍需另用人工标注样本校准，不能把这份编辑包当成已经验证的金标集。
