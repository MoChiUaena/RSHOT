import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { buildScoreInput, type AnalyzeInputArticle } from "@aihot/backend/editorial/analyze";
import { loadAnalyzeInput } from "@aihot/backend/editorial/input";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { sql, closeDb } from "@aihot/backend/db";
import { sha256 } from "@aihot/backend/lib/ids";
import { scopeAwareSummary } from "@aihot/backend/editorial/writing";
after(closeDb);
const material: AnalyzeInputArticle = { id: "source-context", revision: 1, title: "A new remote sensing method", url: "https://user:private-password@publisher.example.org/paper?token=private-query",
  author: null, publishedAt: null, bodyText: "The paper compares a new mechanism with existing methods.", excerpt: null, xPost: null, media: [],
  source: { name: "Original research source", kind: "rss", tier: "T1", firstParty: true } };
test("scoring receives provenance without credentials, query parameters or tier-based feedback", () => {
  const input = buildScoreInput(material);
  assert.ok(input.includes('"host":"publisher.example.org"'));
  assert.ok(input.includes('"firstParty":true'));
  assert.ok(!input.includes("private-password") && !input.includes("private-query"));
  assert.ok(!input.includes('"tier"') && !input.includes("T1"));
  assert.equal(input, buildScoreInput({ ...material, source: { ...material.source, tier: "T2" } }));
});
test("captured abstract scope stops applying when the source body changes", async () => {
  const id = `scope-${Date.now()}`;
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,next_fetch_at) VALUES (${id},'Local scope fixture','rss','T1','editorial','2100-01-01')`;
  const text = "An original abstract describing a remote sensing method.";
  const input = { sourceId: id, url: `https://example.org/${id}`, title: "Local scope material", bodyStatus: "ok" as const, via: "import" as const };
  const first = await upsertMaterial({ ...input, bodyText: text, raw: { rshot: { materialScope: "abstract", scopeBodyHash: sha256(text) } } });
  assert.equal((await loadAnalyzeInput(first.articleId))!.materialScope, "abstract");
  await upsertMaterial({ ...input, bodyText: "A revised body with different source evidence." });
  assert.equal((await loadAnalyzeInput(first.articleId))!.materialScope, undefined);
});
test("shortened copy retains an abstract qualifier without duplicating an existing one", () => {
  assert.equal(scopeAwareSummary("提出一种新方法。", "abstract"), "基于论文摘要，提出一种新方法。");
  assert.equal(scopeAwareSummary("基于论文摘要，作者提出新方法。", "abstract"), "基于论文摘要，作者提出新方法。");
  assert.equal(scopeAwareSummary("已公布工具新功能。", "feed-content"), "已公布工具新功能。");
});
