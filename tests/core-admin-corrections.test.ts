import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { createSource, listSources, updateSource } from "@aihot/backend/admin/sources";
import { detachFromFact, overrideFields, rerun, searchContent, setSeoIndexed, setVisibility } from "@aihot/backend/admin/content";
import { randomUUID } from "node:crypto";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { getBoss, stopBoss } from "@aihot/backend/jobs/queue";

const T = tag();
const sourceId = `admin-${T}`;
await sql`INSERT INTO sources (id, name, kind, tier) VALUES (${sourceId}, 'Admin review', 'rss', 'T1')`;
after(async () => { await stopBoss(); await closeDb(); });

async function article(url = `https://example.com/${tag()}`, title = "审查材料") {
  return (await upsertMaterial({ sourceId, url, title, bodyText: "正文", bodyStatus: "ok", via: "fetch", publishedAt: new Date() })).articleId;
}

test("diagnostics find URL aliases, unpublished titles and an exact ID even when other titles mention it", async () => {
  const tweetId = `${Date.now()}123456`;
  const rawTitle = `只有原文的标题 ${T}`;
  const tweet = await article(`https://x.com/example/status/${tweetId}`, "原始标题");
  const web = await article(`https://example.com/${T}?utm_source=feed`, rawTitle);
  await article(undefined, `引用 ${tweet} 的另一篇文章`);
  assert.deepEqual((await searchContent(tweet)).map((r) => r.id), [tweet]);
  assert.deepEqual((await searchContent(`https://twitter.com/another/status/${tweetId}?s=20`)).map((r) => r.id), [tweet]);
  assert.deepEqual((await searchContent(`https://example.com/${T}?utm_source=other`)).map((r) => r.id), [web]);
  assert.deepEqual((await searchContent(rawTitle)).map((r) => r.id), [web]);
  assert.deepEqual(await searchContent("  "), []);
});

test("concurrent source intake creates one source for the same feed", async () => {
  const blocker = await sql.reserve();
  await blocker`BEGIN`;
  await blocker`LOCK TABLE sources IN SHARE MODE`;
  const pending = Promise.all(Array.from({ length: 4 }, (_, i) => createSource({
    id: `intake-${T}-${i}`, name: "Same feed", kind: "rss", config: { feedUrl: `https://example.com/feed-${T}` },
  }, "test")));
  try {
    // Hold inserts until all four requests have reached a lock: reproduce simultaneous clicks,
    // independently of how quickly the database happens to execute their duplicate checks.
    for (let i = 0; ; i++) {
      const [waiting] = await sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (waiting!.n === 4) break;
      assert.ok(i < 200, "all concurrent requests reached the database");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    await blocker`ROLLBACK`;
    blocker.release();
  }
  const results = await pending;
  assert.equal(results.filter((r) => r.created).length, 1);
  const created = results.find((r) => r.created)!;
  assert.ok(created.created);
  for (const result of results) if (!result.created) assert.equal(result.duplicate.id, created.source.id);
});

test("source counts preserve selected, unselected and out-of-window distinctions", async () => {
  const recent = await article();
  const old = await article();
  const unselected = await article();
  for (const id of [recent, old, unselected]) await publishArticle(id);
  await sql`UPDATE publications SET selected = true, discovered_at = now() - interval '1 day' WHERE article_id = ${recent}`;
  await sql`UPDATE publications SET selected = true, discovered_at = now() - interval '31 days' WHERE article_id = ${old}`;
  const list = await listSources({ q: sourceId });
  assert.equal(list.rows.length, 1);
  assert.equal(list.rows[0]!.selected_30d, 1);
  assert.ok(list.rows[0]!.items_7d >= 3);
});

test("a source transaction rolled back at commit leaves no successful audit entry", async () => {
  await sql.unsafe(`CREATE FUNCTION refuse_admin_source_commit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.name = 'refuse-admin-commit' THEN RAISE EXCEPTION 'refused at commit'; END IF; RETURN NEW; END $$`);
  await sql.unsafe(`CREATE CONSTRAINT TRIGGER refuse_admin_source_commit AFTER UPDATE ON sources
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION refuse_admin_source_commit()`);
  try {
    const [before] = await sql`SELECT updated_at FROM sources WHERE id = ${sourceId}`;
    await assert.rejects(updateSource(sourceId, { patch: { name: "refuse-admin-commit" }, version: (before!.updated_at as Date).toISOString() }, "test-rollback"), /refused at commit/);
    const rows = await sql`SELECT 1 FROM audit_log WHERE actor = 'test-rollback'`;
    assert.equal(rows.length, 0);
  } finally {
    await sql.unsafe("DROP TRIGGER refuse_admin_source_commit ON sources; DROP FUNCTION refuse_admin_source_commit()");
  }
});

test("content corrections, public projection and audit either commit together or remain retryable", async () => {
  const id = await article();
  await publishArticle(id);
  await sql.unsafe(`CREATE FUNCTION refuse_admin_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.actor = 'test-refuse-audit' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$`);
  await sql.unsafe("CREATE TRIGGER refuse_admin_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION refuse_admin_audit()");
  try {
    for (const write of [
      () => overrideFields(id, { fields: { title: "更正标题" }, version: 0, reason: "校正" }, "test-refuse-audit"),
      () => setVisibility(id, { visibility: "withdrawn", version: 0, reason: "校正" }, "test-refuse-audit"),
    ]) {
      await assert.rejects(write(), /audit unavailable/);
      assert.equal((await sql`SELECT 1 FROM editorial_overrides WHERE article_id = ${id}`).length, 0);
      const [p] = await sql`SELECT title, visibility FROM publications WHERE article_id = ${id}`;
      assert.equal(p!.title, "审查材料");
      assert.equal(p!.visibility, "public");
    }
  } finally {
    await sql.unsafe("DROP TRIGGER refuse_admin_audit ON audit_log; DROP FUNCTION refuse_admin_audit()");
  }
  await overrideFields(id, { fields: { title: "更正标题" }, version: 0, reason: "校正" }, "test");
  await assert.rejects(setVisibility(id, { visibility: "withdrawn", version: 0, reason: "过期页面" }, "test"), { code: "conflict" });
  const [p] = await sql`SELECT title, visibility FROM publications WHERE article_id = ${id}`;
  assert.equal(p!.title, "更正标题");
  assert.equal(p!.visibility, "public");
});

test("repeating a completed command returns its job without resetting newer processing or a manual detach", async () => {
  await getBoss();
  for (const step of ["analyze", "extract", "group"] as const) {
    const id = await article();
    const key = `request-${step}-${T}`;
    const first = await rerun(id, step, key, "test");
    assert.ok(first?.jobId);
    await sql`UPDATE pgboss.job SET state = 'completed', completed_on = now() WHERE id = ${first.jobId}`;
    await sql`UPDATE articles SET processing_state = 'analyzed', revision = revision + 1 WHERE id = ${id}`;
    await sql`INSERT INTO grouping_overrides (article_id, reason, actor) VALUES (${id}, 'later manual detach', 'test')`;
    const again = await rerun(id, step, key, "test");
    assert.deepEqual(again, first);
    const [state] = await sql`SELECT processing_state FROM articles WHERE id = ${id}`;
    assert.equal(state!.processing_state, "analyzed");
    assert.equal((await sql`SELECT 1 FROM grouping_overrides WHERE article_id = ${id}`).length, 1);
    assert.equal((await sql`SELECT 1 FROM audit_log WHERE request_id = ${key}`).length, 1);
  }
});

test("a rejected SEO correction leaves both the decision and public indexing unchanged", async () => {
  const id = await article();
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, summary_zh, selected)
            VALUES (${id}, 1, 'rule', 'pass', '可收录的正文摘要', false)`;
  await publishArticle(id);
  const [before] = await sql`SELECT seo_indexed_at, seo_excluded_at, indexable FROM publications WHERE article_id = ${id}`;
  await sql.unsafe(`CREATE FUNCTION refuse_admin_seo_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.actor = 'test-refuse-seo' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$`);
  await sql.unsafe("CREATE TRIGGER refuse_admin_seo_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION refuse_admin_seo_audit()");
  try {
    await assert.rejects(setSeoIndexed(id, { indexed: true, reason: "人工收录" }, "test-refuse-seo"), /audit unavailable/);
    const [after] = await sql`SELECT seo_indexed_at, seo_excluded_at, indexable FROM publications WHERE article_id = ${id}`;
    assert.deepEqual(after, before);
  } finally {
    await sql.unsafe("DROP TRIGGER refuse_admin_seo_audit ON audit_log; DROP FUNCTION refuse_admin_seo_audit()");
  }
  await setSeoIndexed(id, { indexed: true, reason: "人工收录" }, "test");
  const [indexed] = await sql`SELECT seo_indexed_at, seo_excluded_at, indexable FROM publications WHERE article_id = ${id}`;
  assert.ok(indexed!.seo_indexed_at);
  assert.equal(indexed!.seo_excluded_at, null);
  assert.equal(indexed!.indexable, true);
  await setSeoIndexed(id, { indexed: false, reason: "取消收录" }, "test");
  const [excluded] = await sql`SELECT seo_indexed_at, seo_excluded_at, indexable FROM publications WHERE article_id = ${id}`;
  assert.equal(excluded!.seo_indexed_at, null);
  assert.ok(excluded!.seo_excluded_at);
  assert.equal(excluded!.indexable, false);
});

for (const operation of ["visibility", "correction"] as const) {
  test(`selected detach and ${operation} share lock order when detach must append an upsert`, async () => {
    await getBoss();
    const detached = await article();
    const corrected = await article();
    for (const id of [detached, corrected]) {
      await sql`INSERT INTO analyses(article_id,input_revision,origin,relevance,category,title_zh,summary_zh,score,selected)
        VALUES(${id},1,'rule','pass','rs-tools','合成遥感标题','合成遥感摘要',90,true)`;
      await publishArticle(id, { releasedAt: new Date(Date.now() - 60_000) });
    }
    const [story] = await sql<{ id: number }[]>`INSERT INTO stories(public_id,title) VALUES(${randomUUID()},'合成事件') RETURNING id`;
    const [fact] = await sql<{ id: number }[]>`INSERT INTO facts(public_id,story_id,title)
      VALUES(${randomUUID()},${story!.id},'合成事实') RETURNING id`;
    await sql`INSERT INTO fact_articles(fact_id,article_id,role) VALUES(${fact!.id},${detached},'report')`;
    await publishArticle(detached);
    // An unrepublished source-name change forces detach's projection to append a selected upsert.
    const sourceName = `未重发的合成来源-${operation}-${T}`;
    await sql`UPDATE sources SET name=${sourceName} WHERE id=${sourceId}`;
    const hold = await sql.reserve();
    const [{ pid: holderPid }] = await hold<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    const lockKey = 6410201 + Number(operation === "correction");
    let removal: Promise<PromiseSettledResult<unknown>> | undefined;
    let edit: Promise<PromiseSettledResult<unknown>> | undefined;
    const settled = (work: Promise<unknown>): Promise<PromiseSettledResult<unknown>> => work.then(
      value => ({ status: "fulfilled", value }), reason => ({ status: "rejected", reason }));
    async function waitForBlocked(blocker: number): Promise<number> {
      for (let attempt = 0; attempt < 1500; attempt++) {
        const [waiting] = await sql<{ pid: number }[]>`SELECT pid FROM pg_stat_activity
          WHERE datname=current_database() AND ${blocker}=ANY(pg_blocking_pids(pid))`;
        if (waiting) return waiting.pid;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error(`No transaction blocked by backend ${blocker}`);
    }
    try {
      await hold`SELECT pg_advisory_lock(${lockKey})`;
      await sql.unsafe(`CREATE FUNCTION pause_selected_detach() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.id=${fact!.id} THEN PERFORM pg_advisory_xact_lock(${lockKey}); END IF; RETURN NEW; END $$`);
      await sql.unsafe("CREATE TRIGGER pause_selected_detach BEFORE UPDATE ON facts FOR EACH ROW EXECUTE FUNCTION pause_selected_detach()");
      removal = settled(detachFromFact(detached, "合成并发移走", "test"));
      const detachPid = await waitForBlocked(holderPid!);
      edit = settled(operation === "visibility"
        ? setVisibility(corrected, { visibility: "withdrawn", version: 0, reason: "合成并发撤回" }, "test")
        : overrideFields(corrected, { fields: { title: "并发更正的合成安全标题" }, version: 0, reason: "合成并发更正" }, "test"));
      await waitForBlocked(detachPid);
      await hold`SELECT pg_advisory_unlock(${lockKey})`;
      const results = await Promise.all([removal, edit]);
      assert.deepEqual(results.map(result => result.status), ["fulfilled", "fulfilled"],
        results.filter(result => result.status === "rejected").map(result => String(result.reason)).join("; "));
      const [ledger] = await sql`SELECT op,payload FROM selected_ledger WHERE article_id=${detached} ORDER BY seq DESC LIMIT 1`;
      assert.equal(ledger!.op, "upsert");
      assert.equal(ledger!.payload.source.name, sourceName, "the raced detach really appended its changed selected payload");
      assert.equal((await sql`SELECT 1 FROM fact_articles WHERE article_id=${detached}`).length, 0);
      const [publicState] = await sql`SELECT visibility,title FROM publications WHERE article_id=${corrected}`;
      assert.equal(operation === "visibility" ? publicState!.visibility : publicState!.title,
        operation === "visibility" ? "withdrawn" : "并发更正的合成安全标题");
    } finally {
      await hold`SELECT pg_advisory_unlock(${lockKey})`;
      hold.release();
      await Promise.all([removal, edit]);
      await sql.unsafe("DROP TRIGGER IF EXISTS pause_selected_detach ON facts; DROP FUNCTION IF EXISTS pause_selected_detach()");
    }
  });
}
