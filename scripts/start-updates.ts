// A local worker launcher: private credentials stay in its environment, and admission is explicitly bounded.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { spawn } from "node:child_process";
import { projectRoot, readLocalModel } from "./lib/local-model.ts";
import { DEFAULT_COLLECTION_LIMITS } from "@aihot/backend/sources/collection-policy";
const live = process.argv.includes("--live");
const fast = process.argv.includes("--fast");
if (!live) { console.log(JSON.stringify({ status: "ready", ...DEFAULT_COLLECTION_LIMITS, requestsSent: 0 })); process.exit(0); }
const model = readLocalModel();
if (!model.ready) throw new Error("先完成仓库外的模型配置");
if (fast && !/^qwen/i.test(model.env.LLM_MODEL ?? "")) throw new Error("--fast 仅用于支持思考开关的千问模型");
const site = parseEnv(readFileSync(path.join(projectRoot, ".env"), "utf8"));
if (!new URL(site.DATABASE_URL ?? "").pathname.endsWith("_dev")) throw new Error("本机启动器只使用 _dev 预览数据库");
Object.assign(process.env, site);
const { sql, closeDb } = await import("@aihot/backend/db");
const { prepareCollectionPolicy } = await import("@aihot/backend/sources/prepare-collection");
let policy;
try {
  const running = await sql`SELECT 1 FROM settings WHERE key='heartbeat.worker' AND (value->>'at')::timestamptz>now()-interval '2 minutes'`;
  if (running.length) throw new Error("已有活跃 worker，请先检查本地运行状态");
  const overrides = await sql`SELECT key FROM settings WHERE key LIKE 'models.%' AND value->>'model'<>'default'`;
  if (overrides.length) throw new Error("先检查后台模型覆盖配置");
  policy = await prepareCollectionPolicy("local:update-launcher");
  if (!policy.enabled) throw new Error("采集策略已暂停，请先核对后台设置");
} finally { await closeDb(); }
const env: NodeJS.ProcessEnv = { ...process.env, ...site, ...model.env, COLLECT_ENABLED: "true", MODEL_CALLS_ENABLED: "true", ANALYZE_CONCURRENCY: "1", FETCH_CONCURRENCY: "2",
  FEISHU_CONTENT_PUSH_ENABLED: "false", FEISHU_INTERNAL_ENABLED: "false", INDEXNOW_SUBMIT_ENABLED: "false" };
if (fast) {
  env.LLM_EXTRA_JSON = JSON.stringify({ ...JSON.parse(model.env.LLM_EXTRA_JSON || "{}"), enable_thinking: false });
}
const worker = spawn(process.execPath, ["apps/worker/src/main.ts"], { cwd: projectRoot, env, stdio: "inherit" });
const stateFile = path.join(projectRoot, ".data/updates-worker.json");
mkdirSync(path.dirname(stateFile), { recursive: true });
writeFileSync(stateFile, JSON.stringify({ root: projectRoot, launcherPid: process.pid, pid: worker.pid, startedAt: new Date().toISOString(), policy,
  thinkingDisabled: fast, keyStoredInRecord: false }, null, 2));
worker.on("error", () => { console.error("worker 未能启动"); process.exitCode = 1; });
worker.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => worker.kill(signal));
