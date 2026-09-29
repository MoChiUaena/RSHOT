// Read-only source check. Uses the production parsers, never writes database rows or calls a model.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@aihot/backend/config";
import { closeDb } from "@aihot/backend/db";
import { assertSupportedConfig } from "@aihot/backend/sources/config-keys";
import { fetchRss } from "@aihot/backend/sources/rss";
import { fetchJsonList } from "@aihot/backend/sources/json-list";
import { fetchWebList } from "@aihot/backend/sources/web-list";
import { noiseFiltered } from "@aihot/backend/sources/collect";
import type { SourceRow } from "@aihot/backend/sources/types";

const at = process.argv.indexOf("--source");
const only = at >= 0 ? process.argv[at + 1] : null;
const outAt = process.argv.indexOf("--out");
const outPath = outAt >= 0 ? path.resolve(process.argv[outAt + 1]!) : path.join(REPO_ROOT, ".data/source-checks/latest.json");
const pack = JSON.parse(readFileSync(path.join(REPO_ROOT, "industry/sources.json"), "utf8")) as { sources: SourceRow[] };
const sources = pack.sources.filter((s) => s.enabled !== false && (!only || s.id === only));
if (!sources.length) throw new Error("没有匹配的已启用信源");
const results: Array<Record<string, unknown>> = [];
// Bound concurrency; one arXiv query, so its API is never hit by concurrent category queries.
for (let offset = 0; offset < sources.length; offset += 4) {
  const batch = await Promise.all(sources.slice(offset, offset + 4).map(async (item) => {
    const source = { ...item, cursor: null, fail_count: 0 };
    const started = Date.now();
    try {
      assertSupportedConfig(source.kind, source.config);
      const candidates = source.kind === "rss" ? (await fetchRss(source, { force: true })).candidates
        : source.kind === "json_list" ? await fetchJsonList(source)
        : source.kind === "web_list" ? await fetchWebList(source) : [];
      const kept = candidates.filter((c) => !noiseFiltered(c, source));
      const dated = kept.filter((c) => c.publishedAt && Number.isFinite(c.publishedAt.getTime()));
      const result = {
        id: source.id, name: source.name, kind: source.kind, url: source.config.feedUrl ?? source.config.url, checkedAt: new Date().toISOString(),
        ok: kept.length > 0 && dated.length > 0, found: candidates.length, kept: kept.length, dated: dated.length,
        ms: Date.now() - started,
        samples: kept.slice(0, 3).map((c) => ({ title: c.title, url: c.url, publishedAt: c.publishedAt?.toISOString() ?? null, excerpt: (c.excerpt ?? c.bodyText ?? "").slice(0, 500) })),
      };
      console.log(`${result.ok ? "OK" : "EMPTY"} ${source.id}: ${result.kept} entries, ${result.dated} dated`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`FAIL ${source.id}: ${message}`);
      return { id: source.id, name: source.name, kind: source.kind, url: source.config.feedUrl ?? source.config.url, checkedAt: new Date().toISOString(), ok: false, error: message, ms: Date.now() - started };
    }
  }));
  results.push(...batch);
}
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2)}\n`);
await closeDb();
console.log(`Report: ${outPath}`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
