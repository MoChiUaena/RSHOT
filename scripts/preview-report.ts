import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { addDays, beijingDate } from "@aihot/contracts/time";
import { projectRoot } from "./lib/local-model.ts";
const now = new Date();
const date = beijingDate(now);
const nextDue = Number(new Date(now.getTime()+8*3600000).toISOString().slice(11,13)) >= 8 ? addDays(date,1) : date;
const { values } = parseArgs({ options: { date: { type: "string", default: nextDue }, live: { type: "boolean", default: false }, fast: { type: "boolean", default: false } } });
if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date!)) throw new Error("日期格式为 YYYY-MM-DD");
if (!values.live) { console.log(JSON.stringify({ date: values.date, preview: true, requestsSent: 0 })); process.exit(0); }
process.env.MODEL_CALLS_ENABLED = "true";
if (values.fast) {
  if (!/^qwen/i.test(process.env.LLM_MODEL ?? "")) throw new Error("--fast 仅用于支持思考开关的千问模型");
  process.env.LLM_EXTRA_JSON = JSON.stringify({ ...JSON.parse(process.env.LLM_EXTRA_JSON || "{}"), enable_thinking: false });
}
const { composeDaily } = await import("@aihot/backend/reports/compose");
const { closeDb } = await import("@aihot/backend/db");
try {
  const result = await composeDaily(values.date!, "preview", { preview: true });
  const output = path.join(projectRoot, ".data/reports", `preview-${values.date}.json`);
  mkdirSync(path.dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(result.content, null, 2));
  console.log(JSON.stringify({ date: result.key, entries: result.entries, published: false, output }));
} finally { await closeDb(); }
