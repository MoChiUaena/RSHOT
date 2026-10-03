// RSHOT's settled editorial history remains free; explicit recovery keeps its paid identity.
import { Reply, stub, tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { sql, closeDb } from '@aihot/backend/db';
import { importCuratedBundle } from '@aihot/backend/editorial/curation';
import { overrideFields, rerun } from '@aihot/backend/admin/content';
import { processArticle, queueProcessing, registerContentJobs, sweepUnprocessed } from '@aihot/backend/jobs/content';
import { getBoss, stopBoss, QUEUES } from '@aihot/backend/jobs/queue';
import { upsertMaterial } from '@aihot/backend/content/materials';

const T = tag();
const source = 'preserve-' + T;
let refused = false;
const provider = await stub(() => {
  if (!refused) { refused = true; return new Reply(503, {error: 'temporary synthetic outage'}); }
  return {choices: [{message: {content: JSON.stringify({label: 'BLOCK', reason: 'fixture'})}}]};
});
process.env.DASHSCOPE_BASE_URL = provider.url + '/v1';
process.env.DASHSCOPE_API_KEY = 'test-key';
process.env.PREFILTER_MODEL = 'qwen3.7-flash';
let parkedJobs: Array<{id: string; start_after: Date}> = [];
let parkedArticles: Array<{id: string; processing_queued_at: Date | null}> = [];
after(async () => {
  await stopBoss(); await provider.close();
  if (parkedJobs.length) await sql`UPDATE pgboss.job j SET start_after=old.start_after FROM jsonb_to_recordset(${sql.json(parkedJobs as never)}) AS old(id uuid,start_after timestamptz) WHERE j.id=old.id`;
  if (parkedArticles.length) await sql`UPDATE articles a SET processing_queued_at=old.processing_queued_at FROM jsonb_to_recordset(${sql.json(parkedArticles as never)}) AS old(id text,processing_queued_at timestamptz) WHERE a.id=old.id`;
  await closeDb();
});
const wait = async (check: () => Promise<boolean>) => {
  const until = Date.now() + 15000;
  while (!(await check())) { assert.ok(Date.now() < until, 'worker did not settle'); await new Promise(r=>setTimeout(r,20)); }
};

test('manual recovery of curated history retries one logical request and retains human edits and dates', async () => {
  await getBoss();
  parkedJobs = await sql`SELECT id,start_after FROM pgboss.job WHERE state IN ('created','retry')`;
  if (parkedJobs.length) await sql`UPDATE pgboss.job SET start_after='2100-01-01' WHERE id=ANY(${parkedJobs.map(j=>j.id)}::uuid[])`;
  parkedArticles = await sql`SELECT id,processing_queued_at FROM articles WHERE processing_state='new'`;
  if (parkedArticles.length) await sql`UPDATE articles SET processing_queued_at='2100-01-01' WHERE id=ANY(${parkedArticles.map(a=>a.id)}::text[])`;
  await sql`INSERT INTO sources(id,name,kind,tier,participation_mode,next_fetch_at) VALUES(${source},'Synthetic editorial','rss','T1','editorial','2100-01-01')`;
  const url = 'https://example.org/preserve-' + T;
  await upsertMaterial({sourceId:source,url,title:'Remote sensing fixture',bodyText:'Synthetic remote sensing report with complete source evidence. '.repeat(12),bodyStatus:'ok',publishedAt:new Date('2023-01-10T00:00:00Z'),via:'import',backfill:'curated-history'});
  await importCuratedBundle({id: 'preserve-edition-' + T, reviewedAt: '2023-01-16T10:00:00Z', title: '本地编辑', note: '本地假资料', items: [{
    key: 'test', sourceId: source, url, publishedAt: '2023-01-10T00:00:00Z', originalTitle: 'Remote sensing fixture',
    title: '遥感编辑历史', summary: '这是一篇本地遥感研究的历史测试资料，提供明确来源与实验范围，不访问任何外部服务。', category: 'paper', tags: ['论文/研究'], subjects: [], selected: true,
    materialScope: 'abstract', publicationStage: 'preprint',
  }]});
  const [article] = await sql`SELECT id FROM articles WHERE source_id=${source}`;
  const id = article!.id as string;
  assert.deepEqual(await processArticle(id), {state: 'analyzed'});
  assert.equal(provider.hits(), 0, 'settled curated automatic job sends no model work');
  await overrideFields(id, {fields:{title:'保留人工标题'}, reason:'fixture', version:0}, 'test');
  await registerContentJobs(await getBoss(), 1);
  const automatic = await queueProcessing(id);
  await wait(async ()=>(await sql`SELECT state FROM pgboss.job WHERE id=${automatic}`)[0]?.state==='completed');
  assert.equal((await sql`SELECT processing_queued_at FROM articles WHERE id=${id}`)[0]!.processing_queued_at,null,'settled automatic work clears its queue marker');
  assert.equal(provider.hits(),0);
  const first = await rerun(id, 'analyze', 'curated-' + T, 'test');
  await wait(async ()=>(await sql`SELECT state FROM pgboss.job WHERE id=${first!.jobId}`)[0]?.state==='completed');
  assert.equal((await sql`SELECT processing_attempts FROM articles WHERE id=${id}`)[0]!.processing_attempts,1);
  await sql`UPDATE articles SET processing_retry_at=now()-interval '1 minute',created_at=now()-interval '10 minutes' WHERE id=${id}`;
  await sweepUnprocessed();
  await wait(async ()=>(await sql`SELECT 1 FROM pgboss.job WHERE name=${QUEUES.analyze} AND data->>'articleId'=${id} AND state<'completed'`).length===0);
  const receipts = await sql`SELECT logical_key,attempts,status FROM receipts WHERE subject=${'article:' + id + '@1'}`;
  assert.equal(receipts.length,1,'recovery keeps a single logical paid identity');
  assert.equal(receipts[0]!.attempts,2,'one provider failure and one retry');
  assert.equal(receipts[0]!.status,'completed');
  assert.equal(provider.hits(),2);
  assert.equal((await sql`SELECT processing_attempt_tag FROM articles WHERE id=${id}`)[0]!.processing_attempt_tag,'admin:curated-' + T);
  const [publication] = await sql`SELECT title,published_at,timeline_at FROM publications WHERE article_id=${id}`;
  assert.equal(publication!.title,'保留人工标题');
  assert.equal(publication!.published_at.toISOString(),'2023-01-10T00:00:00.000Z');
  assert.equal(publication!.timeline_at.toISOString(),publication!.published_at.toISOString());
  assert.deepEqual(await rerun(id,'analyze','curated-' + T,'test'),first,'durable rerun returns the original completed job');
});

test('an audit failure rolls back an explicit rerun reset and queue insert', async () => {
  const {articleId:id} = await upsertMaterial({sourceId:source,url:'https://example.org/atomic-' + T,title:'Fixture',bodyText:'Complete local fixture',bodyStatus:'ok',via:'fetch'});
  await sql`UPDATE articles SET processing_state='blocked',processing_error='prior verdict',processing_attempts=2 WHERE id=${id}`;
  await sql.unsafe("CREATE FUNCTION fail_rshot_rerun() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor='test-rshot-atomic' THEN RAISE EXCEPTION 'intentional rerun rollback'; END IF; RETURN NEW; END $$");
  await sql.unsafe('CREATE TRIGGER fail_rshot_rerun BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_rshot_rerun()');
  try { await assert.rejects(rerun(id,'analyze','atomic-' + T,'test-rshot-atomic'),/intentional rerun rollback/); }
  finally { await sql.unsafe('DROP TRIGGER fail_rshot_rerun ON audit_log'); await sql.unsafe('DROP FUNCTION fail_rshot_rerun()'); }
  const [row] = await sql`SELECT processing_state,processing_error,processing_attempts FROM articles WHERE id=${id}`;
  assert.deepEqual({...row},{processing_state:'blocked',processing_error:'prior verdict',processing_attempts:2});
  assert.equal((await sql`SELECT 1 FROM pgboss.job WHERE data->>'articleId'=${id}`).length,0);
});
