// Two reviewed public materials by default; saves model results locally without publishing them.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readLocalModel, projectRoot } from "./lib/local-model.ts";
const live = process.argv.includes("--live");
const nAt = process.argv.indexOf("--n");
const n = nAt >= 0 ? Number(process.argv[nAt + 1]) : 2;
if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error("试运行数量必须为1–5");
const materials = JSON.parse(readFileSync(path.join(projectRoot, ".data/review-materials.json"), "utf8")) as { items: Array<{ sourceId: string; sourceName: string; originalTitle: string; url: string; publishedAt: string; text: string }> };
const sample = materials.items.filter((r) => r.sourceId === "arxiv-rs" && r.text.length > 300).slice(0, n);
if (!sample.length) throw new Error("没有可试运行的 arXiv 摘要；先运行 scripts/collect-review.ts");
if (!live) { console.log(JSON.stringify({ status: "ready_for_review", materials: sample.length, requestsSent: 0 })); process.exit(0); }
const profile = readLocalModel();
if (!profile.ready) { console.error(JSON.stringify({ status: "needs_configuration", missing: profile.missing, problems: profile.problems })); process.exit(1); }
process.env.MODEL_CALLS_ENABLED = "true";
Object.assign(process.env, profile.env);
if (process.argv.includes("--fast")) {
  if (!/^qwen/i.test(profile.env.LLM_MODEL ?? "")) throw new Error("--fast 仅用于支持思考开关的千问模型");
  process.env.LLM_EXTRA_JSON = JSON.stringify({ ...JSON.parse(profile.env.LLM_EXTRA_JSON || "{}"), enable_thinking: false });
}
const { sql, closeDb } = await import("@aihot/backend/db");
try {
  await sql`INSERT INTO budgets (service,per_minute,per_hour,per_day,note) VALUES ('llm',20,60,200,'RSHOT 初始小批量试运行')
    ON CONFLICT (service) DO UPDATE SET per_minute=LEAST(budgets.per_minute,20),per_hour=LEAST(budgets.per_hour,60),per_day=LEAST(budgets.per_day,200)`;
  const overrides = await sql`SELECT key FROM settings WHERE key LIKE 'models.%' AND value->>'model' <> 'default'`;
  if (overrides.length) throw new Error("先检查后台的单步骤模型覆盖设置");
  const { runAnalysis, normalizeAnalysis } = await import("@aihot/backend/editorial/analyze");
  const { completeReceipt } = await import("@aihot/backend/providers/receipts");
  const results: Array<Record<string, unknown>> = [];
  const started = Date.now();
  const attemptTag = `pilot-${randomUUID()}`;
  for (const [i, material] of sample.entries()) {
    const result = await runAnalysis({ id: `pilot:${i}:${material.url}`, revision: 1, title: material.originalTitle, url: material.url, author: null,
      publishedAt: new Date(material.publishedAt), bodyStatus: "ok", bodyText: `论文摘要：${material.text}`, excerpt: null, xPost: null, media: [],
      source: { name: material.sourceName, kind: "rss", tier: "T1", firstParty: true } }, { scoreModel: "default", attemptTag });
    const receiptIds = [result.prefilter.receiptId, ...(result.scores?.receiptIds ?? []), ...(result.writing?.receiptIds ?? []), result.structure?.receiptId].filter((id): id is number => typeof id === "number");
    for (const id of receiptIds) await completeReceipt(sql, id);
    results.push({ url: material.url, originalTitle: material.originalTitle, output: normalizeAnalysis(result), receiptIds });
  }
  const dir = path.join(projectRoot, ".data/pilot"); mkdirSync(dir, { recursive: true });
  const ids = results.flatMap((r) => r.receiptIds as number[]);
  const [usage] = await sql`SELECT coalesce(sum((usage->>'prompt_tokens')::int),0)::int AS input_tokens,coalesce(sum((usage->>'completion_tokens')::int),0)::int AS output_tokens,
    coalesce(sum((usage->'completion_tokens_details'->>'reasoning_tokens')::int),0)::int AS reasoning_tokens FROM receipts WHERE id=ANY(${ids}::bigint[])`;
  const elapsedMs = Date.now() - started;
  const file = path.join(dir, `pilot-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), published: false, elapsedMs, usage, results }, null, 2));
  console.log(JSON.stringify({ status: "completed", materials: results.length, published: false, elapsedMs, usage, outputFile: file }));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", errorType: error instanceof Error ? error.name : "unknown", httpStatus: (error as { status?: number }).status ?? null, providerBodyPrinted: false }));
  process.exitCode = 1;
} finally { await closeDb(); }
