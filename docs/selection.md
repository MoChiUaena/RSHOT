# 精选与校准

## 一条资料怎么变成精选

1. **收进来**：同一网址、同一内容只留一份。只有标题或订阅摘要的，先抓原文页面再判断。
2. **预筛**（`prefilter.md`）：这是不是本行业的事。宽进，只拦明显无关的：`BLOCK` 的资料不出现在任何公开页面；`PASS` 和拿不准的 `UNKNOWN` 继续往下走。
3. **评分**（`selection-score.md`）：同一份评分标准独立打两次分（0–100）。**两次之和 ≥ 2 × 门槛**就入选，门槛按信源分级不同。页面上显示的分数是两次的平均（向下取整）。
4. **写标题摘要**：入选的和差一点入选的（平均分高于 `understandFloor`），按 `content-understanding.md` 写中文标题、答案先行的摘要、推荐理由和标签；其余的按 `summarize-*.md` 写简短的标题摘要，进“全部动态”。
5. **结构化**（`structure.md`）：分类、标签、主体公司、事实（谁、做了什么、对什么），和评分同时进行。主题页和事件归组靠它。
6. **归组**（`group-*.md`）：不同来源报道的同一件事归成一个事件，事件页有综述（`story-digest.md`），“热门”按事件排。入选的资料要等归组完成（最多 3 分钟）才出现在精选里，避免同一件事先冒出好几条。
7. **日报、周报、月报**（`report-*.md`）：每天 08:00 出日报（前一天 08:00 到当天 08:00 的精选），每周一 10:00 出上周周报，每月 1 日 10:30 出上月月报。

每一步的提示词都在 `industry/prompts/`，改提示词不用改代码。提示词的版本就是它内容的哈希：改了提示词，之后的新资料按新版判断，已经判过的不会重算。

## 门槛：`industry/selection.ts`

```ts
export const SELECTION = {
  thresholds: { T1: 60, T1_5: 65, T2: 76 },   // 两次评分的平均至少要到这个数
  understandFloor: 50,                        // 平均分高于它的未入选资料，也按入选的写法写
};
```

官方一手信源（T1）门槛低一些，媒体和个人（T2）门槛高一些：同样一件事，官方原文更值得先看。没有门槛的分级（`EXCLUDE_MP`）不参与精选。

这组数是 AIHOT 在 AI 领域一直在用的门槛，偏严：宁可少选几条，也不让噪声进精选。换了行业、改了评分标准，一定要按下面的办法重新校准。

## 校准

### 1. 准备样本集

从你自己的信源里挑 100–200 条资料，一条一条标“该选 / 不该选”，存成 `.data/gold.jsonl`（`.data/` 不进 Git）。每行一条：

```json
{"caseId":"law-001","material":{"title":"原文标题","originalTitle":null,"publishedAt":"2026-10-01T09:00:00+08:00","sourceName":"信源名称","bodyZh":null,"bodyOriginal":"正文……"},"sourceFacts":{"sourceKind":"rss","sourceTier":"T1","firstParty":true,"language":"zh"},"samplingContext":{"benchmarkSplit":"development","samplingStratum":"regulation"},"gold":{"decision":"select"}}
```

| 字段 | 说明 |
|---|---|
| `caseId` | 唯一编号 |
| `material` | 标题、原标题、发布时间、信源名、正文（中文正文放 `bodyZh`，原文放 `bodyOriginal`，有一个就行） |
| `sourceFacts` | 信源类型、分级、是否一手、语言。分级决定用哪个门槛 |
| `samplingContext` | 可选。`benchmarkSplit` 分开发集和留出集，`samplingStratum` 是你自己的分组（比如“新规”“判决”“营销”），看错在哪一类 |
| `gold.decision` | `select` 该选，`reject` 不该选，`either` 两可（不计入准确率） |

`industry/gold.example.jsonl` 有两条示例。

RSHOT 可用 `node scripts/prepare-labeling.ts` 从本地采集材料生成 `.data/calibration/pending.jsonl`，按原文身份去重并固定分组。复制为 `.data/gold.jsonl` 后填写 `gold.decision`；重新准备会覆盖待标注文件。空标签不会自动变成模型标签，评测前会检查是否完成。

也可在后台点选标注：

```powershell
node --env-file=.env scripts/migrate.ts
npm run review:prepare
```

打开 `/admin/calibration`，使用正常管理员登录。首批默认 20 条，科研与工程各半，并轮流取不同来源的有正文或摘要的开发样本；留出集不参与这批筛选。中文导读来自已有编辑包，明确标注为助手整理，不预填判断或展示模型评分。原始材料和链接保留，判断依据由使用者自行核验。

点选后自动保存，备注可选；可返回修改或清除判断。数据在私有数据库的 `calibration_*` 表内，修改有版本校验和审计记录。同一批次重新导入保留人工判断，材料变化时使用新批次。标注页面、导出和准备脚本不调用模型，不更改网站内容。

页面“下载已标注样本”只下载已完成判断的行；或运行 `npm run review:export` 将它们写入 `.data/calibration/gold-<批次编号>.jsonl`。`either` 计入完成进度，评测时不计入准确率。首批用于发现标准不清楚的地方，后续仍需扩充到有代表性的 100–200 条样本。

几条建议：

- 多放**难例**：差一点就该选、差一点就不该选的。一眼就能判断的放太多，准确率会虚高。
- 分出一部分做**留出集**（`benchmarkSplit: "holdout"`），调提示词只看开发集，最后再用留出集检查一遍，免得把提示词调成只会做这几道题。
- 标注的人最好就是以后读这个站的人，或者和他们口味一致的人。

### 2. 跑评测

```bash
node scripts/eval-selection.ts --gold .data/gold.jsonl --split development
node scripts/run-with-model.ts scripts/eval-selection.ts --live --gold .data/gold.jsonl --split development --n 5 --concurrency 1 --label "首批已标注材料"
```

第一条只验证格式与样本数量，不调用模型。第二条通过 [仓库外模型配置](model-setup.md) 做 5 条实测，只在当前进程开启模型调用。核对用量与错例后，再安排剩余样本；`--n` 范围为 1–200，并发为 1–6。

对每条样本跑一遍预筛和两次评分，输出：

- 准确率、查准率（选出来的有多少是对的）、查全率（该选的有多少选上了）；
- 门槛从 40 到 90 每隔 2 分，各自会得到什么结果；
- 判错的条目，完整报告写到 `.data/eval/`，同时导入后台 SelectBench。

常用参数：`--models default,deepseek-flash` 同批比较几个模型，`--n 200` 最多抽多少条，`--split holdout` 只跑留出集。同样的输入和提示词再跑不会重复调用模型（有回执复用），只有改过的部分才会产生新调用。

### 3. 看错例，改标准，再跑

在后台 SelectBench 里逐条看判错的资料和模型给的理由：

- 该选没选上，多半是评分标准里没说清它为什么重要：在 `selection-score.md` 里把这类价值写进“必须正常评价”的部分，给出例子。
- 不该选却选上了，多半是噪声没压住：写进“必须压住”的部分。
- 整体偏松或偏紧，而判错的条目分数都贴着门槛，再调 `industry/selection.ts` 的门槛。

先改标准，再动门槛：门槛只能整体移动，解决不了“哪一类判错了”。每改一次跑一遍，SelectBench 里能看到每一版的对比。

## 换模型

后台“模型与评测”页能看到每一步当前用哪个模型、近期的成功率、耗时和 token 用量，也能直接切换（只影响之后的新任务）。换评分模型之前，先用 `--models` 在同一批样本上比一比。
