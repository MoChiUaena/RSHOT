import { stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { catchUpReports, composeDaily, composeWeekly, composeMonthly } from "@aihot/backend/reports/compose";
import { shutdownSignal, stopBoss } from "@aihot/backend/jobs/queue";

const SOURCE = `catchup-${tag()}`;
let invalidRefs = false;
let stopAfterResponse = false;
const provider = await stub(() => {
  if (stopAfterResponse) shutdownSignal.abort();
  return { choices: [{ message: { content: JSON.stringify({ title: "Local lead", leadParagraph: "Local summary", highlights: [1],
    headline: "Local period", overview: "Local overview", themes: [{ heading: "Local theme", summary: "Local summary", refs: [invalidRefs ? 999 : 1] }] }) } }] };
});
process.env.DEEPSEEK_BASE_URL = `${provider.url}/v1`;
process.env.DEEPSEEK_API_KEY = "test-key";
const now = new Date("2024-02-02T03:00:00Z");
before(async () => {
  await sql`INSERT INTO sources(id,name,kind,tier) VALUES(${SOURCE},'Local catch-up','rss','T1')`;
  await sql.unsafe(`CREATE TABLE catchup_attempts (value jsonb);
    CREATE FUNCTION record_catchup_attempt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.key = 'reports.catch-up.cursor' THEN INSERT INTO catchup_attempts VALUES(NEW.value); END IF;
      RETURN NEW; END $$;
    CREATE TRIGGER record_catchup_attempt AFTER INSERT OR UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION record_catchup_attempt()`);
});
beforeEach(async (t) => {
  if ("mock" in t) t.mock.method(console, "error", () => {}); // Expected failed attempts are asserted below.
  await sql`DELETE FROM reports`;
  await sql`DELETE FROM articles WHERE source_id=${SOURCE}`;
  await sql`DELETE FROM settings WHERE key='reports.catch-up.cursor'`;
  await sql`DELETE FROM catchup_attempts`;
});
after(async () => {
  await sql.unsafe("DROP TRIGGER record_catchup_attempt ON settings; DROP FUNCTION record_catchup_attempt(); DROP TABLE catchup_attempts");
  await provider.close(); await stopBoss(); await closeDb();
});
async function item(at: string) {
  const id = `catchup-item-${tag()}`;
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at)
    VALUES(${id},${SOURCE},${id},'https://example.org/local',${id},${new Date(at)},${new Date(at)})`;
  await sql`INSERT INTO publications(article_id,title,source_id,channel,url,discovered_at,timeline_at,sort_at,eligible,selected,visible_after,visibility,score)
    VALUES(${id},${id},${SOURCE},'news','https://example.org/local',${new Date(at)},${new Date(at)},${new Date(at)},true,true,${new Date(at)},'public',90)`;
}
const report = async (kind: string, key: string) => (await sql`SELECT content,origin,revision FROM reports WHERE kind=${kind} AND key=${key}`)[0];
const attempts = async () => (await sql<{value: {last: Record<string,string>; nextKind: string}}[]>`SELECT value FROM catchup_attempts`).map(({value}) => {
  const kind = value.nextKind === 'weekly' ? 'daily' : value.nextKind === 'monthly' ? 'weekly' : 'monthly';
  return `${kind}:${value.last[kind]}`;
});

test("catch-up counts failed attempts and durably advances through gaps and periodic issues", async () => {
  await sql`INSERT INTO reports(kind,key,window_start,window_end,content,origin,generated_at)
    VALUES('daily','2024-01-20',now(),now(),'{"sections":[{"items":[{"title":"Frozen local"}]}]}','manual',now())`;
  await item("2024-01-22T12:00:00Z");
  await item("2024-02-01T12:00:00Z");
  const before = await report('daily','2024-01-20');
  const calls = provider.hits();
  await assert.rejects(catchUpReports(now,3), /report catch-up: daily:2024-01-21 failed/);
  const first = await attempts();
  assert.deepEqual(first, ['daily:2024-01-21','weekly:2024-W04','monthly:2024-01']);
  assert.ok(provider.hits()-calls <= 3);
  assert.ok(await report('weekly','2024-W04')); assert.ok(await report('monthly','2024-01'));
  await sql`DELETE FROM catchup_attempts`;
  await assert.rejects(catchUpReports(now,3), /daily:2024-01-22/);
  const second = await attempts();
  assert.equal(second.length,3); assert.equal(new Set(second).size,3);
  assert.ok(!second.includes('daily:2024-01-21'), "the next invocation resumes past failed keys");
  for(let run=0;run<4 && !(await report('daily','2024-02-02'));run++) {
    await catchUpReports(now,3).catch((error) => assert.match(String(error), /report catch-up:/));
  }
  assert.ok(await report('daily','2024-02-02'));
  assert.deepEqual(await report('daily','2024-01-20'),before);
  const frozenCalls = provider.hits();
  assert.equal((await composeDaily('2024-01-20')).entries,1);
  assert.deepEqual(await report('daily','2024-01-20'),before);
  assert.equal(provider.hits(),frozenCalls);
});

test("periodic manual editions without metrics or storyOrder remain frozen", async () => {
  const content = { themes: [{ storyRefs: [{title:'Frozen local'}] }] };
  for(const [kind,key,compose] of [['weekly','2024-W04',composeWeekly],['monthly','2024-01',composeMonthly]] as const) {
    await sql`INSERT INTO reports(kind,key,window_start,window_end,content,origin,generated_at)
      VALUES(${kind},${key},now(),now(),${sql.json(content)},'manual',now())`;
    const before = await report(kind,key); const calls = provider.hits();
    assert.equal((await compose(key,'catch-up')).entries,1);
    assert.deepEqual(await report(kind,key),before); assert.equal(provider.hits(),calls);
  }
});

test("a budget refusal remains a missing retryable issue", async () => {
  await item('2024-02-01T12:00:00Z');
  const [budget] = await sql`SELECT per_minute FROM budgets WHERE service='deepseek'`;
  const calls = provider.hits();
  try {
    await sql`UPDATE budgets SET per_minute=0 WHERE service='deepseek'`;
    await assert.rejects(catchUpReports(now,1), /daily:2024-02-02/);
    assert.equal(await report('daily','2024-02-02'),undefined);
    assert.equal(provider.hits(),calls);
  } finally { await sql`UPDATE budgets SET per_minute=${budget!.per_minute} WHERE service='deepseek'`; }
  await catchUpReports(now,3);
  assert.ok(await report('daily','2024-02-02'));
});

test("period output without valid references is rejected without publication", async () => {
  await item('2024-02-01T12:00:00Z'); invalidRefs=true;
  try { await assert.rejects(composeMonthly('2024-02'), /no theme cites/); }
  finally { invalidRefs=false; }
  assert.equal(await report('monthly','2024-02'),undefined);
});

test("shutdown stops before the next compose attempt", async () => {
  await item('2024-02-01T12:00:00Z'); stopAfterResponse=true;
  const calls=provider.hits();
  const result = await catchUpReports(now,3);
  assert.deepEqual(result,{generated:['daily:2024-02-02'],failed:[]});
  assert.equal((await attempts()).length,1); assert.equal(provider.hits()-calls,1);
  assert.deepEqual(await catchUpReports(now,3),{generated:[],failed:[]});
  assert.equal((await attempts()).length,1);
});
