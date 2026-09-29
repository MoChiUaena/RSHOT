// Creates .env from .env.example with fresh random secrets and an admin password, and prints the password
// once. Refuses to overwrite an existing .env.   node scripts/init-env.ts [--llm-key <key>]
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

if (existsSync(".env")) {
  console.error(".env 已经存在，没有覆盖。要重新生成，先把它改名或删掉。");
  process.exit(1);
}
const password = randomBytes(12).toString("base64url");
const keyAt = process.argv.indexOf("--llm-key");
const llmKey = keyAt > 0 ? (process.argv[keyAt + 1] ?? "") : "";
const preview = process.argv.includes("--preview");
const text = readFileSync(".env.example", "utf8")
  .replace(/^ADMIN_PASSWORD=$/m, `ADMIN_PASSWORD=${password}`)
  .replace(/^SESSION_SECRET=$/m, `SESSION_SECRET=${randomBytes(32).toString("hex")}`)
  .replace(/^IMG_PROXY_SIGN_SECRET=$/m, `IMG_PROXY_SIGN_SECRET=${randomBytes(32).toString("hex")}`)
  .replace(/^POSTGRES_PASSWORD=$/m, `POSTGRES_PASSWORD=${randomBytes(18).toString("hex")}`)
  .replace(/^LLM_API_KEY=$/m, `LLM_API_KEY=${llmKey}`)
  .replace(/^COLLECT_ENABLED=true$/m, `COLLECT_ENABLED=${!preview}`)
  .replace(/^MODEL_CALLS_ENABLED=true$/m, `MODEL_CALLS_ENABLED=${!preview}`);
writeFileSync(".env", text, { mode: 0o600 });
console.log("已生成 .env。");
console.log(`管理员密码：${password}（也写在 .env 的 ADMIN_PASSWORD 里）`);
if (preview) console.log("预览模式：自动采集与付费模型调用关闭。可导入人工编辑包。");
else if (!llmKey) console.log("还差一步：在 .env 里填上 LLM_API_KEY（以及 LLM_BASE_URL、LLM_MODEL，默认是 DeepSeek）。");
