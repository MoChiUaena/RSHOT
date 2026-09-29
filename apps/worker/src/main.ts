// Worker process: queues and schedules for collection, processing, events, reports, monitors and ops.
import { assertProductionSecrets } from "@aihot/backend/config";
import { FEATURES } from "@aihot/industry/features";
import { closeDb, sql } from "@aihot/backend/db";
import { getBoss, stopBoss } from "@aihot/backend/jobs/queue";
import { registerContentJobs } from "@aihot/backend/jobs/content";
import { registerSourceJobs } from "@aihot/backend/jobs/sources";
import { registerEventJobs } from "@aihot/backend/jobs/events";
import { registerNotifyJobs } from "@aihot/backend/jobs/notify";
import { registerPublicationJobs } from "@aihot/backend/jobs/publication";
import { registerSchedules } from "./schedules.ts";
import { ensureContentTargets } from "@aihot/backend/notify/deliver";
import { startHeartbeat } from "@aihot/backend/operations/heartbeat";
import { scheduleDueSources } from "@aihot/backend/sources/collect";

assertProductionSecrets([["auth", "IMG_PROXY_SIGN_SECRET"]]);

await ensureContentTargets();
const boss = await getBoss();
await registerContentJobs(boss);
if (process.env.COLLECT_ENABLED !== "false") await registerSourceJobs(boss);
await registerEventJobs(boss);
await registerNotifyJobs(boss);
await registerPublicationJobs(boss);
await registerSchedules(boss);
// A new site has no leaderboard until the first scheduled round: compute one now.
if (FEATURES.leaderboard) {
  const [published] = await sql`SELECT 1 FROM lb_runs WHERE status = 'published' LIMIT 1`;
  if (!published) await boss.send("cron.leaderboard.round", {}, { singletonKey: "first-round" });
}
const heartbeat = startHeartbeat("worker");
if (process.env.COLLECT_ENABLED !== "false") await scheduleDueSources();
console.log(JSON.stringify({ level: "info", msg: "worker started", pid: process.pid }));

let stopping = false;
let controlTimer: NodeJS.Timeout | null = null;
const workerStartedAt = Date.now();
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ level: "info", msg: "worker stopping" }));
  clearInterval(heartbeat);
  if (controlTimer) clearInterval(controlTimer);
  await stopBoss();
  await sql`DELETE FROM settings WHERE key='heartbeat.worker' AND value->>'pid'=${String(process.pid)}`;
  await closeDb();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
// The local launcher can request an orderly stop without exposing credentials or killing a paid call.
controlTimer = setInterval(() => {
  void sql`SELECT value->>'at' AS at FROM settings WHERE key='worker.stop-request'`.then(([request]) => {
    if (request && Date.parse(request.at) > workerStartedAt) void shutdown();
  }).catch(() => {});
}, 5000);
controlTimer.unref();
