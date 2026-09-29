// Prepare a fixed private batch with unfilled decisions; Chinese editorial copy is reading guidance.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT } from "@aihot/backend/config";
import { closeDb } from "@aihot/backend/db";
import { sha256, stableJson } from "@aihot/backend/lib/ids";
import { chooseDevelopmentCases, importCalibrationBatch, PendingCalibrationSchema } from "@aihot/backend/admin/calibration";

const { values } = parseArgs({ options: { input: { type: "string", default: ".data/calibration/pending.jsonl" }, n: { type: "string", default: "20" } } });
const rows = readFileSync(path.resolve(REPO_ROOT, values.input!), "utf8").split(/\r?\n/).filter((s) => s.trim()).map((s) => PendingCalibrationSchema.parse(JSON.parse(s)));
const canonical = (s: string) => s.replace(/(arxiv\.org\/abs\/\d+\.\d+)v\d+$/, "$1");
const guides = new Map<string, { title: string; summary: string }>();
const directory = path.join(REPO_ROOT, "industry/curation");
for (const file of readdirSync(directory).filter((f) => f.endsWith(".json")).sort()) {
  const edition = JSON.parse(readFileSync(path.join(directory, file), "utf8"));
  for (const item of edition.items) guides.set(canonical(item.url), { title: item.title, summary: item.summary });
}
const cases = chooseDevelopmentCases(rows, Number(values.n)).map((row) => {
  const guide = guides.get(canonical(row.review.sourceUrl));
  return { ...row, review: { ...row.review, titleZh: guide?.title ?? null, guideZh: guide?.summary ?? null } };
});
if (!cases.length) throw new Error("没有带来源材料的开发集样本");
const batch = { id: `first-${sha256(stableJson(cases)).slice(0, 12)}`, label: "首批精选偏好 · 科研与工程", cases };
try {
  const result = await importCalibrationBatch(batch);
  const output = path.join(REPO_ROOT, ".data/calibration/first-batch.json");
  mkdirSync(path.dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(batch, null, 2));
  console.log(JSON.stringify({ ...result, research: cases.filter((r) => r.review.focus === "research").length, engineering: cases.filter((r) => r.review.focus === "engineering").length,
    chineseGuides: cases.filter((r) => r.review.guideZh).length, holdoutCases: 0, labelledByScript: 0, requestsSent: 0, page: "/admin/calibration", output }));
} finally { await closeDb(); }
