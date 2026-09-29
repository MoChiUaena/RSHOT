// Collect dated materials for human editing. Does not publish, enqueue work or call a model.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@aihot/backend/config";
import { closeDb } from "@aihot/backend/db";
import { fetchRss } from "@aihot/backend/sources/rss";
import { fetchWebList, fetchDetail } from "@aihot/backend/sources/web-list";
import { fetchJsonList } from "@aihot/backend/sources/json-list";
import { noiseFiltered } from "@aihot/backend/sources/collect";
import { assertSupportedConfig } from "@aihot/backend/sources/config-keys";
import type { SourceRow } from "@aihot/backend/sources/types";

const now = new Date();
const cutoff = new Date(now.getTime() - 14 * 86400_000);
const pack = JSON.parse(readFileSync(path.join(REPO_ROOT, "industry/sources.json"), "utf8")) as { sources: SourceRow[] };
const items: Array<Record<string, unknown>> = [];
const errors: Array<{ sourceId: string; error: string }> = [];
for (let offset = 0; offset < pack.sources.length; offset += 4) {
  await Promise.all(pack.sources.slice(offset, offset + 4).filter((s) => s.enabled !== false).map(async (item) => {
    const source = { ...item, cursor: null, fail_count: 0 };
    try {
      assertSupportedConfig(source.kind, source.config);
      const rows = source.kind === "rss" ? (await fetchRss(source, { force: true })).candidates
        : source.kind === "web_list" ? await fetchWebList(source) : await fetchJsonList(source);
      const recent = rows.filter((r) => r.publishedAt && r.publishedAt >= cutoff && r.publishedAt <= now && !noiseFiltered(r, source)).slice(0, 35);
      for (const row of recent) {
        let text = row.bodyText ?? row.excerpt ?? "";
        let scope = row.bodyText ? "feed-content" : row.excerpt ? "feed-summary" : "listing-title";
        if (source.kind === "web_list" && !text) {
          try {
            const detail = await fetchDetail(row.url, source, { title: false, date: false, summary: true, body: true });
            text = detail.body?.text ?? detail.summary ?? "";
            if (text) scope = source.config.detail?.summaryIsBody === true ? "abstract" : "article-text";
          } catch { /* Keep the source title and mark the missing text for the editor. */ }
        }
        items.push({ sourceId: source.id, sourceName: source.name, url: row.url, originalTitle: row.title,
          publishedAt: row.publishedAt!.toISOString(), materialScope: source.id === "arxiv-rs" ? "abstract" : scope,
          text: text.slice(0, 14000), capturedAt: new Date().toISOString() });
      }
      console.log(`${source.id}: ${recent.length} recent materials`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ sourceId: source.id, error: message });
      console.log(`${source.id}: ${message}`);
    }
  }));
}
items.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
const output = path.join(REPO_ROOT, ".data/review-materials.json");
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ capturedAt: now.toISOString(), cutoff: cutoff.toISOString(), items, errors }, null, 2)}\n`);
await closeDb();
console.log(`${items.length} materials saved to ${output}`);
