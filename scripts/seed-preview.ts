// Compatibility command for the local preview; imports the reviewed RSHOT edition.
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, config } from "@aihot/backend/config";
import { importCuratedBundle } from "@aihot/backend/editorial/curation";
import { closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
if (process.env.NODE_ENV === "production" || !new URL(config.databaseUrl).pathname.endsWith("_dev")) throw new Error("预览命令只允许本地 *_dev 数据库");
if (config.modelCallsEnabled || process.env.COLLECT_ENABLED !== "false") throw new Error("先关闭自动采集与模型调用");
try {
  console.log(JSON.stringify(await importCuratedBundle(JSON.parse(readFileSync(path.join(REPO_ROOT, "industry/curation/2026-09-29.json"), "utf8")))));
} finally { await stopBoss(); await closeDb(); }
