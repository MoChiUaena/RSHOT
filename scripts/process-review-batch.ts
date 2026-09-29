// Explicit local batches only. Existing articles are preserved; no crawler or continuous worker starts.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { readLocalModel, projectRoot } from "./lib/local-model.ts";
const { values } = parseArgs({ options: { input: { type: "string" }, live: { type: "boolean", default: false }, fast: { type: "boolean", default: false } } });
if (!values.input) throw new Error("指定已核验的本地批次 --input");
const inputFile = path.resolve(values.input);
const schema = z.array(z.object({ sourceId: z.string(), originalTitle: z.string().min(1), url: z.string().url().refine((s) => { const u = new URL(s); return u.protocol === "https:" && !u.username && !u.password; }),
  publishedAt: z.string().datetime(), text: z.string().min(1).max(60000), materialScope: z.enum(["abstract", "article-text", "feed-content", "feed-summary"]) })).min(1).max(5);
const materials = schema.parse(JSON.parse(readFileSync(inputFile, "utf8")));
if (new Set(materials.map((m) => m.url)).size !== materials.length) throw new Error("批次网址重复");
if (!values.live) { console.log(JSON.stringify({ status: "ready", materials: materials.length, requestsSent: 0, published: false })); process.exit(0); }
const model = readLocalModel();
if (!model.ready) throw new Error("本机模型配置未完成");
Object.assign(process.env, model.env);
process.env.MODEL_CALLS_ENABLED = "true";
if (!["false", "0"].includes((process.env.COLLECT_ENABLED ?? "").toLowerCase())) throw new Error("小批量运行时先明确关闭持续采集");
if (values.fast) {
  if (!/^qwen/i.test(model.env.LLM_MODEL ?? "")) throw new Error("--fast 仅用于支持思考开关的千问模型");
  process.env.LLM_EXTRA_JSON = JSON.stringify({ ...JSON.parse(model.env.LLM_EXTRA_JSON || "{}"), enable_thinking: false });
}
const { sql, closeDb } = await import("@aihot/backend/db");
const { stopBoss } = await import("@aihot/backend/jobs/queue");
const { identityKeyFor, upsertMaterial } = await import("@aihot/backend/content/materials");
const { processArticle } = await import("@aihot/backend/jobs/content");
const { sha256 } = await import("@aihot/backend/lib/ids");
const { collapseWhitespace } = await import("@aihot/backend/lib/text");
const output = path.join(projectRoot, ".data/pilot", `processed-${sha256(inputFile).slice(0, 12)}.json`);
const inputHash = sha256(JSON.stringify(materials));
type Item = { url: string; articleId: string | null; state: string };
const previous = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : null;
if (previous && previous.inputHash !== inputHash) throw new Error("同路径批次材料已变化，请使用新文件名保留原批次记录");
const results: Item[] = previous?.results ?? [];
const save = () => { mkdirSync(path.dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify({ inputFile, inputHash, updatedAt: new Date().toISOString(), results }, null, 2)); };
try {
  if (!new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_dev")) throw new Error("批次发布只用于本地 _dev 预览库");
  const overrides = await sql`SELECT key FROM settings WHERE key LIKE 'models.%' AND value->>'model'<>'default'`;
  if (overrides.length) throw new Error("先核对后台单步骤模型覆盖");
  await sql`INSERT INTO budgets (service,per_minute,per_hour,per_day,note) VALUES ('llm',20,60,200,'RSHOT 小批量处理')
    ON CONFLICT(service) DO UPDATE SET per_minute=LEAST(budgets.per_minute,20),per_hour=LEAST(budgets.per_hour,60),per_day=LEAST(budgets.per_day,200)`;
  for (const material of materials) {
    let record = results.find((r) => r.url === material.url);
    if (record && record.state !== "pending") continue;
    if (!record) {
      const identity = identityKeyFor({ sourceId: material.sourceId, url: material.url, title: material.originalTitle, via: "import" });
      const [existing] = await sql`SELECT id FROM articles WHERE identity_key=${identity} OR url=${material.url} LIMIT 1`;
      if (existing) { results.push({ url: material.url, articleId: existing.id, state: "preserved_existing" }); save(); continue; }
    }
    let waiting = false;
    while (true) {
      const [budget] = await sql`SELECT per_minute,per_hour,per_day FROM budgets WHERE service='llm'`;
      const [counts] = await sql`SELECT count(*) FILTER(WHERE started_at>now()-interval '1 minute')::int AS minute,
        count(*) FILTER(WHERE started_at>now()-interval '1 hour')::int AS hour,count(*)::int AS day FROM receipt_attempts
        WHERE service='llm' AND origin='live' AND started_at>now()-interval '1 day'`;
      if (!budget || budget.per_minute < 6 || counts!.hour + 6 > budget.per_hour || counts!.day + 6 > budget.per_day) throw new Error("预算不足以开始下一条资料，请稍后检查本地后台");
      if (counts!.minute + 6 <= budget.per_minute) break;
      if (!waiting) console.log(JSON.stringify({ status: "waiting_for_minute_budget" }));
      waiting = true; await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    const [source] = await sql`SELECT id FROM sources WHERE id=${material.sourceId} AND enabled=true AND participation_mode='editorial'`;
    if (!source) throw new Error("批次包含未启用的编辑信源");
    if (!record) {
      const identity = identityKeyFor({ sourceId: material.sourceId, url: material.url, title: material.originalTitle, via: "import" });
      const [existing] = await sql`SELECT id FROM articles WHERE identity_key=${identity} OR url=${material.url} LIMIT 1`;
      if (existing) { results.push({ url: material.url, articleId: existing.id, state: "preserved_existing" }); save(); continue; }
      const found = await upsertMaterial({ sourceId: material.sourceId, url: material.url, title: material.originalTitle, publishedAt: new Date(material.publishedAt),
        language: /[一-鿿]/.test(material.originalTitle) ? "zh" : "en", bodyStatus: "ok", bodyText: material.text, via: "import",
        raw: { rshot: { materialScope: material.materialScope, scopeBodyHash: sha256(collapseWhitespace(material.text)), mode: "bounded-model-batch" } } });
      record = { url: material.url, articleId: found.articleId, state: "pending" }; results.push(record); save();
    }
    const processed = await processArticle(record.articleId!);
    record.state = processed.state; save();
    if (!["pass", "block"].includes(processed.state)) throw new Error("批次资料尚未完成处理");
  }
  console.log(JSON.stringify({ status: "completed", materials: materials.length, results, output }));
} catch (error) {
  console.error(JSON.stringify({ status: "stopped", errorType: error instanceof Error ? error.name : "unknown", httpStatus: (error as { status?: number }).status ?? null, providerBodyPrinted: false, output }));
  process.exitCode = 1;
} finally { await stopBoss(); await closeDb(); }
