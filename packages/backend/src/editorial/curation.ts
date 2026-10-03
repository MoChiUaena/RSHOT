// Human-reviewed editions share the normal publication projection. No provider requests or scores.
import { z } from "zod";
import { CATEGORIES, ENTITIES, CATEGORY_TAGS, TOPIC_TAGS, ENTITY_TAGS } from "@aihot/industry/taxonomy";
import { CATEGORY_KEYS } from "@aihot/contracts/taxonomy";
import { addDays, beijingDate, beijingMidnight, isoWeekLabel, isoWeekRange } from "@aihot/contracts/time";
import { SITE } from "@aihot/industry/site";
import { sql } from "../db.ts";
import { upsertMaterial } from "../content/materials.ts";
import { publishArticleTx } from "../publication/publish.ts";
import { sha256, stableJson } from "../lib/ids.ts";

const knownTags = new Set<string>([...CATEGORY_TAGS, ...TOPIC_TAGS, ...ENTITY_TAGS]);
const instant = z.string().refine((s) => /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s)), "带时区的日期无效");
const ItemSchema = z.object({
  key: z.string().min(1), sourceId: z.string().min(1), url: z.string().url().refine((s) => new URL(s).protocol === "https:", "来源必须使用 HTTPS"),
  publishedAt: instant, originalTitle: z.string().min(1), title: z.string().min(1).max(200), summary: z.string().min(30).max(1500),
  category: z.enum(CATEGORY_KEYS), tags: z.array(z.string()).min(1).max(6).refine((a) => a.every((t) => knownTags.has(t)), "含未知标签"),
  subjects: z.array(z.string()).max(6).refine((a) => a.every((s) => Object.hasOwn(ENTITIES, s)), "含未知主体"),
  selected: z.boolean(), materialScope: z.enum(["abstract", "article-text", "feed-content", "feed-summary", "listing-title"]),
  publicationStage: z.enum(["preprint", "published", "announcement", "release"]),
}).strict();
const BundleSchema = z.object({ id: z.string().min(1), reviewedAt: instant, title: z.string().min(1), note: z.string(), items: z.array(ItemSchema).min(1).max(200) }).strict();
export type CuratedBundle = z.infer<typeof BundleSchema>;
type Item = CuratedBundle["items"][number];

export function validateCuratedBundle(input: unknown): CuratedBundle {
  const bundle = BundleSchema.parse(input);
  if (new Set(bundle.items.map((i) => i.key)).size !== bundle.items.length || new Set(bundle.items.map((i) => i.url)).size !== bundle.items.length) throw new Error("编辑包包含重复编号或网址");
  if (bundle.items.some((i) => Date.parse(i.publishedAt) > Date.parse(bundle.reviewedAt))) throw new Error("发布日期晚于核对日期");
  if (bundle.items.some((i) => !(CATEGORY_TAGS as readonly string[]).includes(i.tags[0]!))) throw new Error("首标签必须为内容类型");
  return bundle;
}

async function saveManualReport(kind: "daily" | "weekly" | "monthly", key: string, start: Date, end: Date, content: Record<string, unknown>) {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`report:${kind}:${key}`}))`;
    const [before] = await tx<{ id: number; origin: string; content: unknown; revision: number; generated_at: Date }[]>`SELECT id,origin,content,revision,generated_at FROM reports WHERE kind=${kind} AND key=${key} FOR UPDATE`;
    // An edition importer does not replace an automatically produced issue or another editor's work.
    if (before && (before.origin !== "manual" || (before.content as any)?.generator?.mode !== "curated-edition"
      || (before.content as any)?.generator?.edition !== (content.generator as any)?.edition)) return false;
    if (before && stableJson(before.content) === stableJson(content)) return false;
    if (before) {
      await tx`INSERT INTO report_revisions (report_id,revision,content,generated_at,reason) VALUES (${before.id},${before.revision},${tx.json(before.content as never)},${before.generated_at},'更新人工编辑包') ON CONFLICT DO NOTHING`;
      await tx`UPDATE reports SET content=${tx.json(content as never)},window_start=${start},window_end=${end},generated_at=now(),revision=revision+1,model=NULL,origin='manual',updated_at=now() WHERE id=${before.id}`;
    } else {
      await tx`INSERT INTO reports (kind,key,window_start,window_end,content,generated_at,model,origin) VALUES (${kind},${key},${start},${end},${tx.json(content as never)},now(),NULL,'manual')`;
    }
    return true;
  });
}

export async function importCuratedBundle(input: unknown): Promise<{ items: number; selected: number; reports: number; preserved: number }> {
  const bundle = validateCuratedBundle(input);
  const sourceIds = [...new Set(bundle.items.map((i) => i.sourceId))];
  const sources = await sql<{ id: string; name: string; first_party: boolean; participation_mode: string }[]>`SELECT id,name,first_party,participation_mode FROM sources WHERE id=ANY(${sourceIds}::text[])`;
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  if (sourceIds.some((id) => !sourceMap.has(id) || sourceMap.get(id)!.participation_mode !== "editorial")) throw new Error("先导入对应的 editorial 信源，再导入编辑包");
  const refs: Array<{ item: Item; citation: Record<string, unknown> }> = [];
  let preserved = 0;
  for (const item of bundle.items) {
    const found = await upsertMaterial({ sourceId: item.sourceId, url: item.url, title: item.originalTitle, language: /[一-鿿]/.test(item.originalTitle) ? "zh" : "en",
      publishedAt: new Date(item.publishedAt), bodyStatus: "none", via: "import", backfill: "curated-history",
      raw: { rshot: { edition: bundle.id, materialScope: item.materialScope, publicationStage: item.publicationStage, reviewedAt: bundle.reviewedAt } } });
    const imported = await sql.begin(async (tx) => {
      const [article] = await tx<{ revision: number }[]>`SELECT revision FROM articles WHERE id=${found.articleId} FOR UPDATE`;
      const [latest] = await tx<{ origin: string; model: string | null; prompt_version: string | null; input_revision: number }[]>`SELECT origin,model,prompt_version,input_revision FROM analyses WHERE article_id=${found.articleId} ORDER BY input_revision DESC,id DESC LIMIT 1`;
      const overrides = await tx`SELECT 1 FROM editorial_overrides WHERE article_id=${found.articleId}`;
      if (overrides.length || (latest && (latest.origin !== "rule" || latest.model))) return false;
      const version = `rshot-curated:${bundle.id}@${sha256(stableJson(item)).slice(0, 16)}`;
      const reason = `编辑整理 · ${item.materialScope === "abstract" ? "依据论文摘要" : item.materialScope === "listing-title" ? "依据来源列表标题" : "依据原文材料"}；${item.publicationStage === "preprint" ? "预印本或讨论稿，" : ""}无模型评分。`;
      if (!latest || latest.prompt_version !== version || latest.input_revision !== article!.revision) await tx`
      INSERT INTO analyses (article_id,input_revision,origin,prompt_version,relevance,category,tags,subjects,title_zh,summary_zh,reason_zh,score,selected,output)
      VALUES (${found.articleId},${article!.revision},'rule',${version},'pass',${item.category},${item.tags},${item.subjects},${item.title},${item.summary},${reason},NULL,${item.selected},
        ${tx.json({ curation: { edition: bundle.id, reviewedAt: bundle.reviewedAt, materialScope: item.materialScope, publicationStage: item.publicationStage } } as never)})`;
      // Commit the manual judgement, completion state and public projection together.
      await tx`UPDATE articles SET timeline_at=coalesce(published_at,timeline_at),backfill=true,backfill_reason='curated-history',
        processing_state='analyzed',processing_error=NULL,processing_attempts=0,processing_retry_at=NULL,processing_queued_at=NULL WHERE id=${found.articleId}`;
      await publishArticleTx(tx, found.articleId, { releasedAt: new Date() });
      return true;
    });
    if (!imported) { preserved += 1; continue; }
    const source = sourceMap.get(item.sourceId)!;
    refs.push({ item, citation: { itemId: found.articleId, title: item.title, summary: item.summary, sourceId: source.id, sourceName: source.name, sourceUrl: item.url,
      firstParty: source.first_party, role: "编辑整理", publishedAt: item.publishedAt, score: null, factId: null, storyPublicId: null } });
  }
  const selected = refs.filter((r) => r.item.selected);
  if (!selected.length) return { items: refs.length, selected: 0, reports: 0, preserved };
  const reviewed = new Date(bundle.reviewedAt);
  const today = beijingDate(reviewed);
  const generator = { mode: "curated-edition", edition: bundle.id, reviewedAt: bundle.reviewedAt, model: null };
  const sections = (rows: typeof refs) => CATEGORIES.map((c) => ({ label: c.section, items: rows.filter((r) => r.item.category === c.key).map((r) => r.citation) })).filter((s) => s.items.length);
  let reports = 0;
  for (let date = beijingDate(new Date(Math.min(...selected.map((r) => Date.parse(r.item.publishedAt))))); date <= today; date = addDays(date, 1)) {
    const end = new Date(beijingMidnight(date).getTime() + 8 * 3600_000);
    if (end > reviewed) continue;
    const start = new Date(end.getTime() - 86400_000);
    const rows = selected.filter((r) => new Date(r.item.publishedAt) >= start && new Date(r.item.publishedAt) < end);
    if (!rows.length) continue;
    const grouped = sections(rows);
    const labels = grouped.map((s) => s.label).join("、");
    const content = { date, lead: { title: rows[0]!.item.title, leadParagraph: `本期关注${labels}，收录 ${rows.length} 条来源可追溯的遥感动态。本期为编辑整理版，论文与数据条目注明材料依据，研究结论请结合原文的实验条件阅读。` },
      highlights: rows.slice(0, 3).map((r) => r.citation.itemId), sections: grouped, flashes: [], windowStart: start.toISOString(), windowEnd: end.toISOString(),
      metrics: { totalEvents: rows.length, sourcesCount: new Set(rows.map((r) => r.item.sourceId)).size, firstPartyEvents: rows.filter((r) => r.citation.firstParty).length }, generator };
    if (await saveManualReport("daily", date, start, end, content)) reports += 1;
  }
  for (const week of [...new Set(selected.map((r) => isoWeekLabel(beijingDate(new Date(r.item.publishedAt)))))]) {
    const range = isoWeekRange(week)!;
    const start = beijingMidnight(range.start), end = beijingMidnight(addDays(range.end, 1));
    if (end > reviewed) continue; // Never present the incomplete current week as a completed weekly issue.
    const rows = selected.filter((r) => new Date(r.item.publishedAt) >= start && new Date(r.item.publishedAt) < end);
    const themes = sections(rows).map((s) => ({ heading: s.label, summary: `本周整理 ${s.items.length} 条${s.label}资料，以下条目保留原文入口与材料范围。`, storyRefs: s.items }));
    const content = { kind: "weekly", title: `${SITE.name} 周报 · ${week}`, isoLabel: week, periodStart: range.start, periodEnd: range.end,
      headline: "遥感研究、数据与工程进展", overview: `本期覆盖 ${range.start} 至 ${range.end}，编辑整理 ${rows.length} 条遥感科研与工程资料。论文、数据集与工具分节呈现，预印本与正式发表状态按来源标注。`,
      themes, storyOrder: rows.map((r) => r.citation.itemId), metrics: { totalStories: rows.length, selectedCount: rows.length,
        reportsCovered: Number((await sql`SELECT count(*) AS n FROM reports WHERE kind='daily' AND key>=${range.start} AND key<=${range.end}`)[0]!.n) }, generator };
    if (await saveManualReport("weekly", week, start, end, content)) reports += 1;
  }
  for (const month of [...new Set(selected.map((r) => beijingDate(new Date(r.item.publishedAt)).slice(0, 7)))]) {
    const start = beijingMidnight(`${month}-01`);
    const [year, m] = month.split("-").map(Number);
    const next = m === 12 ? `${year! + 1}-01-01` : `${year}-${String(m! + 1).padStart(2, "0")}-01`;
    const fullEnd = beijingMidnight(next), end = fullEnd < reviewed ? fullEnd : reviewed;
    const lastDay = beijingDate(new Date(end.getTime() - 1));
    const rows = selected.filter((r) => new Date(r.item.publishedAt) >= start && new Date(r.item.publishedAt) < end);
    const content = { kind: "monthly", title: `${SITE.name} 月度观察 · ${month}（截至 ${lastDay}）`, monthLabel: month, periodStart: `${month}-01`, periodEnd: lastDay,
      headline: "遥感研究、数据与工程观察", overview: `本期仅统计已收录的 ${rows.length} 条资料，截至 ${lastDay}，由编辑整理；不表示已覆盖整月或全行业动态。`,
      themes: sections(rows).map((s) => ({ heading: s.label, summary: `本期收录 ${s.items.length} 条${s.label}资料。`, storyRefs: s.items })),
      storyOrder: rows.map((r) => r.citation.itemId), metrics: { totalStories: rows.length, selectedCount: rows.length,
        reportsCovered: Number((await sql`SELECT count(*) AS n FROM reports WHERE kind='daily' AND key>=${`${month}-01`} AND key<=${lastDay}`)[0]!.n) }, generator };
    if (await saveManualReport("monthly", month, start, end, content)) reports += 1;
  }
  return { items: refs.length, selected: selected.length, reports, preserved };
}
