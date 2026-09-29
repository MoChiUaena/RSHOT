// Prepare review cases without inventing human gold labels. Output stays in ignored local data.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const root = path.resolve(import.meta.dirname, "..");
const inputAt = process.argv.indexOf("--input");
const file = inputAt >= 0 ? path.resolve(process.argv[inputAt + 1]!) : path.join(root, ".data/review-materials.json");
const pack = JSON.parse(readFileSync(path.join(root, "industry/sources.json"), "utf8"));
const sources = new Map<string, any>(pack.sources.map((s: any) => [s.id, s]));
const materials = JSON.parse(readFileSync(file, "utf8")).items as Array<Record<string, string>>;
const unique = new Map<string, Record<string, string>>();
for (const item of materials) {
  const identity = item.url.replace(/\?source=.*$/, "").replace(/(arxiv\.org\/abs\/\d+\.\d+)v\d+$/, "$1");
  if (!unique.has(identity)) unique.set(identity, item);
}
const rows = [...unique].slice(0, 150).map(([identity, item]) => {
  const hash = createHash("sha256").update(identity).digest("hex");
  const source = sources.get(item.sourceId);
  return { caseId: `rs-${hash.slice(0, 12)}`, material: { title: item.originalTitle, originalTitle: item.originalTitle, publishedAt: item.publishedAt,
    sourceName: item.sourceName, bodyZh: null, bodyOriginal: item.text || null }, sourceFacts: { sourceKind: source?.kind ?? "rss", sourceTier: source?.tier ?? "T2", firstParty: source?.first_party ?? false, language: /[一-鿿]/.test(item.originalTitle) ? "zh" : "en" },
    samplingContext: { benchmarkSplit: parseInt(hash.slice(0, 2), 16) % 5 === 0 ? "holdout" : "development", samplingStratum: item.materialScope },
    review: { sourceUrl: item.url, materialScope: item.materialScope }, gold: { decision: null } };
});
const dir = path.join(root, ".data/calibration"); mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "pending.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(JSON.stringify({ cases: rows.length, labelled: 0, output: path.join(dir, "pending.jsonl"), readyForEvaluation: false }));
