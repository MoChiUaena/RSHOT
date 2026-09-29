# 模型配置与试运行

本机模型配置保存在 Git 仓库外。测试脚本把配置传给单个后端进程；网页不接收模型密钥。

## 1. 填写外部配置

需要 Node.js 24.11+，已安装项目依赖，且 `.env` 指向迁移完成的本地开发数据库。

```powershell
npm run model:prepare
```

默认文件在 Windows 的 `%LOCALAPPDATA%\RSHOT\models.env`，Linux 的 `$XDG_CONFIG_HOME/RSHOT/models.env`（未设置时使用 `~/.config/RSHOT/models.env`）。命令显示文件位置，并保留已有配置。可用环境变量 `RSHOT_MODEL_FILE` 指定其他仓库外路径；实际路径落在仓库内的文件会被拒绝。

| 字段 | 填写内容 |
|---|---|
| `LLM_BASE_URL` | 服务商的 OpenAI 兼容基础地址，通常以 `/v1` 结尾；不要加 `/chat/completions` |
| `LLM_MODEL` | API 支持的模型标识，按服务商文档填写 |
| `LLM_API_KEY` | 服务商密钥，只填写在这个外部文件中 |
| `LLM_EXTRA_JSON` | 附加请求参数，默认 `{}` |
| `LLM_JSON_MODE` | 默认 `true`，接口需支持 JSON 输出 |
| `LLM_VISION` | 默认 `false`，摘要试运行不需要图像输入 |

公开地址使用 HTTPS；明确配置的内网网关可使用 HTTP。基础地址不能包含账号密码、查询参数或片段。区域、基础地址、模型和密钥应对应同一服务；更改任一项后重新测试。

`.env` 中保持 `COLLECT_ENABLED=false`、`MODEL_CALLS_ENABLED=false`。后面的 `--live` 只为当前测试进程启用模型调用。

## 2. 验证连接

```powershell
npm run model:check
node scripts/run-with-model.ts scripts/probe-model.ts --live
```

第一条只检查配置，不访问模型。第二条发送一次短请求，验证 JSON 输出，显示状态、耗时与 token 用量，不打印服务商错误正文。每次实测使用新的回执身份，避免把旧响应当成当前连接成功。

最后一次连接状态保存到 `.data/pilot/connection-status.json`，只代表文件中记录的测试时刻。

## 3. 小批量处理真实材料

先收集待编辑材料；这一步读取公开信源，不调用模型或发布内容：

```powershell
node --env-file=.env scripts/collect-review.ts
node scripts/pilot.ts
node scripts/run-with-model.ts scripts/pilot.ts --live --n 2
```

试运行从 `.data/review-materials.json` 选择有摘要的 arXiv 遥感资料，依次运行预筛、两次评分、中文写作和结构化。未通过预筛的资料会提前结束。`--n` 限制为 1–5，默认 2；不带 `--live` 只检查可用材料。每次 `--live` 都重新调用，结果、耗时与用量保存在 `.data/pilot/`，回执保存到本地数据库，内容不进入网站。

连接测试和试运行会把模型预算收紧到最多每分钟 20 次、每小时 60 次、滚动 24 小时 200 次；已有更低或为零的限制保留。这些是请求次数上限，费用仍取决于模型和 token 用量。后台存在单步骤模型覆盖时，试运行要求先核对这些设置。

支持关闭思考的千问模型可使用：

```powershell
node scripts/run-with-model.ts scripts/pilot.ts --live --n 1 --fast
```

`--fast` 在当前进程合并 `enable_thinking:false`，保留其他附加参数，不修改外部文件。部分千问模型只支持思考模式，需以 [DashScope 文档](https://help.aliyun.com/zh/model-studio/deep-thinking) 和实际接口结果为准。若后续选择此模式，将该字段合并到外部文件的 `LLM_EXTRA_JSON`，并用相同参数做质量校准。

## 4. 人工校准后再启用持续运行

连接和少量摘要成功，只能证明流程可用。先准备待标注材料：

```powershell
node scripts/prepare-labeling.ts
```

输出 `.data/calibration/pending.jsonl`，默认最多 150 条，按原文身份去重并固定开发集与留出集。`gold.decision` 初始为空；由使用者根据原文和阅读需求填写 `select`、`reject` 或 `either`。这些是待标注材料，不是已校准的金标集。重跑准备脚本会覆盖 `pending.jsonl`；开始标注前复制为 `.data/gold.jsonl`。

按 [精选与校准](selection.md) 验证已标注文件。评测脚本在任何付费调用前拒绝空标签、重复编号和格式错误；不带 `--live` 只做本地验证。先评测小批量，再根据用量安排完整评测，保持留出集独立。评分门槛不因两条成功样例而调整。

使用 `npm run review:prepare` 可将首批开发样本导入后台 `/admin/calibration`，通过点选保存判断。完成后用 `npm run review:export` 导出已标注文件，再将实际导出路径传给评测的 `--gold`；标注与导出不产生模型调用。

个人阅读偏好的文件会自动作为偏好参照，指标表示一致程度。按 [精选依据](editorial-policy.md) 核验的质量样本和个人兴趣判断应保留各自用途，不能用少量兴趣标签确定跨方向的质量门槛。

### 在本地发布明确的小批量

维护者核对具体材料后，可用 `scripts/process-review-batch.ts --input .data/pilot/你的批次.json` 检查，再通过 `run-with-model.ts` 为同一个命令添加 `--live`。只支持本地 `_dev` 库和 1–5 条材料；每条包含 `sourceId`、`originalTitle`、`url`、UTC `publishedAt`、`text`、`materialScope`。

该脚本按正常分析与公共发布层处理，保留原始来源日期，已有资料会跳过。材料范围与正文指纹绑定，更新正文后旧范围说明失效。批次记录保存在 `.data/pilot/`，相同材料可继续未完成的处理；改动批次内容需用新文件名。分钟预算不足时等待，小时或日预算不足时停止，不提高已有预算。它要求关闭持续采集，不启动 worker；已入选条目遵循正常归组或最长 3 分钟的展示等待。

支持思考开关的千问模型可添加 `--fast`，只调整本次进程。处理完的结果仍需核对贡献、摘要与来源，不将批次执行成功视为全站质量已经校准。

已有历史编辑包应在采集与模型开关关闭时重新导入一次，修复旧的待处理状态；确认后台处理状态和首次采集窗口后，再由后端加载外部配置：

```powershell
node scripts/run-with-model.ts apps/api/src/main.ts
node scripts/run-with-model.ts apps/worker/src/main.ts
```

这两条遵循 `.env` 中的开关，不会自行开启采集。Docker 部署使用服务器私有环境或凭据目录，外部配置文件不会打包进镜像。

## 5. 提交和推送保护

```powershell
npm run setup:hooks
npm run check:secrets
node scripts/check-secrets.ts --history HEAD
```

本地 hooks 检查暂存内容和即将推送的提交历史，包括曾写入、后来删除的密钥。检查常见凭据格式、私有文件路径，以及本机 `.env`、外部模型文件中配置的密钥值；输出仅包含文件、行号和规则。已有其他 hooks 配置时安装器保留它，需手动串联检查。

GitHub CI 会检查已跟踪文件和完整提交历史。`.env`、`*.env`、`.data/`、凭据目录与私钥文件保持忽略。仓库中的示例只能用空值或明确的开发占位符；本机密钥、服务商错误正文、测试输出和数据库导出都不提交。
