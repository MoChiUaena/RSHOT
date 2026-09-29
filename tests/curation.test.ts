import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { validateCuratedBundle, importCuratedBundle } from "@aihot/backend/editorial/curation";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { overrideFields } from "@aihot/backend/admin/content";

const T = tag();
const sourceId = `curation-${T}`;
const bundle = {
  id: `edition-${T}`, reviewedAt: "2023-01-16T10:00:00Z", title: "人工编辑测试", note: "本地来源假数据，无外部请求",
  items: [0, 1].map((n) => ({ key: `item-${n}`, sourceId, url: `https://example.org/curation-${T}/${n}`, publishedAt: `2023-01-${n ? "12" : "10"}T00:00:00Z`,
    originalTitle: `Satellite research ${n}`, title: `遥感研究 ${n}`, summary: "研究在明确的实验条件下比较遥感方法，给出数据与验证范围。这是本地测试材料，不引用外部服务。",
    category: "paper" as const, tags: ["论文/研究", "光学遥感"], subjects: [], selected: true, materialScope: "abstract" as const, publicationStage: "preprint" as const })),
};
after(async () => { await stopBoss(); await closeDb(); });

test("curation rejects ambiguous editions before writing", () => {
  assert.equal(validateCuratedBundle(bundle).items.length, 2);
  assert.throws(() => validateCuratedBundle({ ...bundle, items: [bundle.items[0], bundle.items[0]] }), /重复/);
  assert.throws(() => validateCuratedBundle({ ...bundle, items: [{ ...bundle.items[0], publishedAt: "2024-01-01T00:00:00Z" }] }), /晚于/);
  assert.throws(() => validateCuratedBundle({ ...bundle, items: [{ ...bundle.items[0], tags: ["不存在的标签"] }] }), /未知标签/);
});

test("an edition is repeatable, retains source dates, and preserves subsequent human and model decisions", async () => {
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,next_fetch_at) VALUES (${sourceId},'Local editorial source','rss','T1','editorial','2100-01-01')`;
  const first = await importCuratedBundle(bundle);
  assert.equal(first.items, 2);
  const rows = await sql<{ article_id: string; score: number | null; timeline_at: Date; published_at: Date; backfill: boolean }[]>`SELECT article_id,score,timeline_at,published_at,backfill FROM publications WHERE source_id=${sourceId} ORDER BY url`;
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.score, null);
    assert.equal(row.timeline_at.toISOString(), row.published_at.toISOString());
    assert.equal(row.backfill, true);
  }
  const ids = rows.map((r) => r.article_id);
  const count = async () => Number((await sql`SELECT count(*) AS n FROM analyses WHERE article_id=ANY(${ids}::text[])`)[0]!.n);
  const before = await count();
  await importCuratedBundle(bundle);
  assert.equal(await count(), before, "rerunning does not invent another editorial judgement");
  assert.equal(Number((await sql`SELECT count(*) AS n FROM receipts WHERE subject=ANY(${ids.map((id) => `article:${id}@1`)}::text[])`)[0]!.n), 0);
  await overrideFields(ids[0]!, { fields: { title: "保留人工修改" }, reason: "人工修改测试", version: 0 }, "test-editor");
  await sql`INSERT INTO analyses (article_id,input_revision,origin,model,relevance,category,title_zh,summary_zh,score,selected)
    VALUES (${ids[1]!},1,'model','local-test-model','pass','paper','保留模型结果','模型假服务已经处理的内容，应保留而不被样例导入覆盖。',91,true)`;
  await publishArticle(ids[1]!, { releasedAt: new Date() });
  const rerun = await importCuratedBundle(bundle);
  assert.equal(rerun.preserved, 2);
  const titles = await sql<{ title: string }[]>`SELECT title FROM publications WHERE source_id=${sourceId} ORDER BY url`;
  assert.deepEqual(titles.map((r) => r.title), ["保留人工修改", "保留模型结果"]);
});
