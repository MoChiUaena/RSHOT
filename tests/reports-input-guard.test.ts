// A received model answer cannot freeze prose from an input revoked or corrected during HTTP.
// Mutations, publication, report reads and receipts are real; only the provider is loopback HTTP.
import { gate, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { closeDb, sql } from "@aihot/backend/db";
import { updateSource } from "@aihot/backend/admin/sources";
import { overrideFields, setVisibility } from "@aihot/backend/admin/content";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle, publishArticleTx } from "@aihot/backend/publication/publish";
import { loadReport } from "@aihot/backend/publication/reports";
import { composeDaily, composeWeekly, composeMonthly } from "@aihot/backend/reports/compose";

let held: { entered: ReturnType<typeof gate<void>>; finish: ReturnType<typeof gate<void>> } | undefined;
const provider = await stub(async (_hit, request) => {
  const input = JSON.parse(request.body).messages.at(-1).content as string;
  const current = held;
  held = undefined;
  if (current) { current.entered.open(); await current.finish.promise; }
  const prose = input.includes("更正后的结论") ? "fresh corrected prose" : "obsolete in-flight prose";
  return { choices: [{ message: { content: JSON.stringify({ title: "测试导语", leadParagraph: prose, highlights: [1],
    headline: "测试标题", overview: prose, themes: [{ heading: "主题", summary: prose, refs: [1] }] }) } }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
});
process.env.DEEPSEEK_BASE_URL = `${provider.url}/v1`;
process.env.DEEPSEEK_API_KEY = "test-key";
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  assert.equal(url.hostname, "127.0.0.1", "report QA may contact only its loopback provider");
  return realFetch(input, init);
};
after(async () => {
  console.log(JSON.stringify({ localReportStubRequests: provider.hits() }));
  globalThis.fetch = realFetch;
  await provider.close(); await stopBoss(); await closeDb();
});

async function fixture(at: string) {
  const sourceId = `report-input-${tag()}`;
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at)
    VALUES (${sourceId}, 'Synthetic report input', 'rss', 'T1', 'editorial', '2100-01-01')`;
  const { articleId } = await upsertMaterial({ sourceId, url: `https://example.com/${sourceId}`, title: `原始结论 ${sourceId}`,
    bodyText: "Synthetic original body", bodyStatus: "ok", publishedAt: new Date(at), discoveredAt: new Date(at), via: "fetch" });
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected)
    VALUES (${articleId}, 1, 'rule', 'pass', 'rs-tools', ${`原始结论 ${sourceId}`}, '原始摘要', 90, true)`;
  await publishArticle(articleId, { now: new Date(at), releasedAt: new Date(at) });
  return { sourceId, articleId };
}
async function sourceMode(id: string, mode: "editorial" | "isolated") {
  const [source] = await sql<{ updated_at: Date }[]>`SELECT updated_at FROM sources WHERE id = ${id}`;
  await updateSource(id, { patch: { participation_mode: mode }, version: source!.updated_at.toISOString() }, "test");
}
const stored = async (kind: string, key: string) => (await sql`SELECT content, origin, revision, generated_at FROM reports WHERE kind = ${kind} AND key = ${key}`)[0];

const cases = [
  { kind: "daily", key: "2010-01-02", at: "2010-01-01T12:00:00Z", compose: composeDaily, edit: "source" },
  { kind: "daily", key: "2010-02-02", at: "2010-02-01T12:00:00Z", compose: composeDaily, edit: "withdrawal" },
  { kind: "daily", key: "2010-03-02", at: "2010-03-01T12:00:00Z", compose: composeDaily, edit: "text" },
  { kind: "weekly", key: "2011-W01", at: "2011-01-04T12:00:00Z", compose: composeWeekly, edit: "source" },
  { kind: "monthly", key: "2011-02", at: "2011-02-01T12:00:00Z", compose: composeMonthly, edit: "text" },
] as const;

for (const c of cases) test(`${c.kind} rejects a late ${c.edit} change and normal retry gets a fresh response`, async () => {
  const { sourceId, articleId } = await fixture(c.at);
  const beforeCalls = provider.hits();
  const pendingGate = { entered: gate(), finish: gate() };
  held = pendingGate;
  const pending = c.compose(c.key);
  const outcome = Promise.allSettled([pending]);
  try {
    await Promise.race([pendingGate.entered.promise, delay(5000).then(() => assert.fail("provider was not entered"))]);
    if (c.edit === "source") await sourceMode(sourceId, "isolated");
    else if (c.edit === "withdrawal") await setVisibility(articleId, { visibility: "withdrawn", reason: "test revoke", version: 0 }, "test");
    else await overrideFields(articleId, { fields: { title: "更正后的结论", summary: "更正后的摘要" }, reason: "test correction", version: 0 }, "test");
    // Completion of the real mutation while HTTP is gated also proves no report transaction spans it.
    pendingGate.finish.open();
    const [result] = await outcome;
    assert.equal(result!.status, "rejected", "obsolete answer must fail instead of freezing an issue");
    if (result!.status === "rejected") assert.match(String(result.reason), /inputs changed/i);
    assert.equal(await loadReport(c.kind, c.key), null, "public readers cannot see the old prose");
    assert.equal(await stored(c.kind, c.key), undefined);
    const [receipt] = await sql`SELECT id, status, completed_at, error FROM receipts WHERE subject = ${`report:${c.kind}:${c.key}`} ORDER BY id DESC LIMIT 1`;
    assert.equal(receipt!.status, "failed", "the stale saved answer is consumed as unusable");
    assert.equal(receipt!.completed_at, null);
    assert.match(String(receipt!.error), /inputs changed/i);
    const attempts = await sql`SELECT status FROM receipt_attempts WHERE receipt_id = ${receipt!.id}`;
    assert.deepEqual(attempts.map((r) => r.status), ["received"], "the paid request remains counted with its actual result");
    assert.equal(provider.hits() - beforeCalls, 1);
    if (c.edit === "source") await sourceMode(sourceId, "editorial");
    if (c.edit === "withdrawal") await setVisibility(articleId, { visibility: "public", reason: "test restore", version: 1 }, "test");
    await c.compose(c.key);
    const retried = await loadReport(c.kind, c.key);
    assert.ok(retried);
    assert.equal(provider.hits() - beforeCalls, 2, "retry cannot reuse the rejected answer, even when the old prompt is restored");
    assert.equal(retried.revision, 1);
    if (c.edit === "text") assert.equal(c.kind === "daily" ? retried.lead?.leadParagraph : retried.overview, "fresh corrected prose");
    assert.equal((await sql`SELECT status FROM receipts WHERE subject = ${`report:${c.kind}:${c.key}`} ORDER BY id DESC LIMIT 1`)[0]!.status, "completed");
  } finally { pendingGate.finish.open(); await outcome; held = undefined; }
});

test("a stale explicit regeneration preserves the published edition and creates no revision", async () => {
  const key = "2012-01-02";
  const { articleId } = await fixture("2012-01-01T12:00:00Z");
  await composeDaily(key);
  const original = await stored("daily", key);
  await overrideFields(articleId, { fields: { title: "Slow obsolete correction" }, reason: "test", version: 0 }, "test");
  const pendingGate = { entered: gate(), finish: gate() };
  held = pendingGate;
  const pending = composeDaily(key, "editor correction");
  const outcome = Promise.allSettled([pending]);
  try {
    await pendingGate.entered.promise;
    await overrideFields(articleId, { fields: { title: "更正后的结论" }, reason: "test", version: 1 }, "test");
    pendingGate.finish.open();
    assert.equal((await outcome)[0]!.status, "rejected");
    assert.deepEqual(await stored("daily", key), original);
    assert.equal((await sql`SELECT 1 FROM report_revisions v JOIN reports r ON r.id = v.report_id WHERE r.kind = 'daily' AND r.key = ${key}`).length, 0);
    await composeDaily(key, "editor correction");
    assert.equal((await loadReport("daily", key))!.lead!.leadParagraph, "fresh corrected prose");
    assert.equal((await stored("daily", key)).revision, 2);
  } finally { pendingGate.finish.open(); await outcome; held = undefined; }
});

for (const origin of ["manual", "model"] as const) test(`an edition frozen as ${origin} during HTTP remains unchanged after input revocation`, async () => {
  const key = origin === "manual" ? "2013-01-02" : "2013-02-02";
  const { sourceId } = await fixture(origin === "manual" ? "2013-01-01T12:00:00Z" : "2013-02-01T12:00:00Z");
  const pendingGate = { entered: gate(), finish: gate() };
  held = pendingGate;
  const pending = composeDaily(key);
  const outcome = Promise.allSettled([pending]);
  try {
    await pendingGate.entered.promise;
    await sql`INSERT INTO reports (kind, key, window_start, window_end, content, origin, generated_at)
      VALUES ('daily', ${key}, '2013-01-01', '2013-01-02', ${sql.json({ lead: { title: "Frozen", leadParagraph: "Preserved edition" }, sections: [] })}, ${origin}, now())`;
    const frozen = await stored("daily", key);
    await sourceMode(sourceId, "isolated");
    pendingGate.finish.open();
    assert.equal((await outcome)[0]!.status, "fulfilled");
    assert.deepEqual(await stored("daily", key), frozen);
    assert.equal((await loadReport("daily", key))!.lead!.leadParagraph, "Preserved edition");
    assert.equal((await sql`SELECT status FROM receipts WHERE subject = ${`report:daily:${key}`}`)[0]!.status, "completed");
    const calls = provider.hits();
    await composeDaily(key, "catch-up");
    assert.equal(provider.hits(), calls);
  } finally { pendingGate.finish.open(); await outcome; held = undefined; }
});

/** Return the real backend waiting on a transaction, or fail if the operation escapes the guard. */
async function blockedBy(blocker: number, operation: Promise<unknown>): Promise<number> {
  const deadline = performance.now() + 5000;
  while (true) {
    const [waiting] = await sql<{ pid: number }[]>`SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND ${blocker} = ANY(pg_blocking_pids(pid)) LIMIT 1`;
    if (waiting) return waiting.pid;
    assert.ok(performance.now() < deadline, "operation must reach the held transaction");
    await Promise.race([operation.then(() => assert.fail("edit committed while final report save was held")), delay(10)]);
  }
}

for (const edit of ["source", "withdrawal", "text"] as const) test(`final validation and prose commit serialize with an actual ${edit} writer`, async () => {
  const month = edit === "source" ? "01" : edit === "withdrawal" ? "02" : "03";
  const key = `2014-${month}-02`;
  const { sourceId, articleId } = await fixture(`2014-${month}-01T12:00:00Z`);
  const entered = gate<number>(), release = gate();
  const holding = sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('qa_report_final_save_gate'))`;
    entered.open((await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid);
    await release.promise;
  });
  // Block the INSERT after the guard's fresh read, inside the real save transaction.
  await sql.unsafe(`CREATE FUNCTION hold_report_final_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('qa_report_final_save_gate')); RETURN NEW; END $$;
    CREATE TRIGGER hold_report_final_save BEFORE INSERT ON reports FOR EACH ROW EXECUTE FUNCTION hold_report_final_save()`);
  let report: Promise<unknown> | undefined, writer: Promise<unknown> | undefined;
  try {
    const pid = await entered.promise;
    report = composeDaily(key);
    const reportPid = await blockedBy(pid, report);
    const [source] = await sql<{ updated_at: Date }[]>`SELECT updated_at FROM sources WHERE id = ${sourceId}`;
    // A name edit has no story invalidation: it must still participate in the snapshot barrier.
    writer = edit === "source" ? updateSource(sourceId, { patch: { name: "Corrected source attribution" }, version: source!.updated_at.toISOString() }, "test")
      : edit === "withdrawal" ? setVisibility(articleId, { visibility: "withdrawn", reason: "test", version: 0 }, "test")
        : overrideFields(articleId, { fields: { title: "更正后的结论" }, reason: "test", version: 0 }, "test");
    const writerDone = Promise.allSettled([writer]);
    await blockedBy(reportPid, writer);
    release.open();
    await holding;
    await report;
    assert.equal((await writerDone)[0]!.status, "fulfilled", "the editor proceeds after the short save, without a lock inversion");
    assert.equal((await stored("daily", key)).revision, 1);
    assert.equal((await sql`SELECT status FROM receipts WHERE subject = ${`report:daily:${key}`}`)[0]!.status, "completed");
    const saved = await stored("daily", key), calls = provider.hits();
    await composeDaily(key, "catch-up");
    assert.deepEqual(await stored("daily", key), saved, "the edition valid at commit remains frozen after the later edit");
    assert.equal(provider.hits(), calls);
  } finally {
    release.open();
    await Promise.allSettled([holding, report, writer]);
    await sql.unsafe("DROP TRIGGER hold_report_final_save ON reports; DROP FUNCTION hold_report_final_save()");
  }
});

test("source promotion resuming a skipped article cannot invert the publication membership lock", async () => {
  const { sourceId } = await fixture("2015-01-01T12:00:00Z");
  await sourceMode(sourceId, "isolated");
  const { articleId } = await upsertMaterial({ sourceId, url: `https://example.com/${sourceId}/skipped`, title: "等待恢复的资料",
    bodyText: "Synthetic skipped body", bodyStatus: "ok", publishedAt: new Date("2015-01-01T13:00:00Z"), discoveredAt: new Date("2015-01-01T13:00:00Z"), via: "fetch" });
  await sql`UPDATE articles SET processing_state = 'skipped' WHERE id = ${articleId}`;
  const acquired = gate<number>(), publish = gate();
  const publication = sql.begin(async (tx) => {
    await tx`SELECT id FROM articles WHERE id = ${articleId} FOR UPDATE`;
    acquired.open((await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid);
    await publish.promise;
    await publishArticleTx(tx, articleId);
  });
  let promotion: Promise<unknown> | undefined;
  try {
    const pid = await acquired.promise;
    promotion = sourceMode(sourceId, "editorial");
    await blockedBy(pid, promotion);
    publish.open();
    const results = await Promise.allSettled([publication, promotion]);
    assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled"], "publication and promotion must both commit without deadlock");
    assert.equal((await sql`SELECT processing_state FROM articles WHERE id = ${articleId}`)[0]!.processing_state, "new");
    assert.equal((await sql`SELECT participation_mode FROM sources WHERE id = ${sourceId}`)[0]!.participation_mode, "editorial");
  } finally { publish.open(); await Promise.allSettled([publication, promotion]); }
});
