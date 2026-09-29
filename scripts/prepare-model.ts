import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defaultModelFile, readLocalModel } from "./lib/local-model.ts";

const file = path.resolve(process.env.RSHOT_MODEL_FILE || defaultModelFile());
readLocalModel(file); // Check the destination before creating anything.
mkdirSync(path.dirname(file), { recursive: true });
if (!existsSync(file)) writeFileSync(file, `# RSHOT 本机模型配置；该文件在 Git 仓库外。\n# 填写你的服务商基础地址（通常以 /v1 结尾）、模型标识和密钥。\n# 不要将密钥发送到聊天、GitHub Issue 或 README。\nLLM_BASE_URL=\nLLM_MODEL=\nLLM_API_KEY=\nLLM_EXTRA_JSON={}\nLLM_JSON_MODE=true\nLLM_VISION=false\n`, { mode: 0o600 });
const result = readLocalModel(file);
console.log(JSON.stringify({ file: result.file, configured: result.ready, missing: result.missing, problems: result.problems }));
