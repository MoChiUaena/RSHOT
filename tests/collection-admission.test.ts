import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { storeControlled, withinCollectionWindow } from "@aihot/backend/sources/admission";
import { DEFAULT_COLLECTION_LIMITS, type CollectionPolicy } from "@aihot/backend/sources/collection-policy";
import { collectSource } from "@aihot/backend/sources/collect";
import type { Candidate, SourceRow } from "@aihot/backend/sources/types";
const T = tag();
const A = `admission-a-${T}`, B = `admission-b-${T}`, R = `admission-rss-${T}`;
const source = (id: string): SourceRow => ({ id, name: "Local fixture", kind: "rss", config: {}, tier: "T1", participation_mode: "editorial", first_party: true,
  interval_minutes: 60, enabled: true, cursor: null, fail_count: 0 });
const item = (name: string): Candidate => ({ url: `https://example.org/${T}/${name}`, title: name, bodyText: `Source evidence ${name}`, bodyStatus: "ok", publishedAt: new Date() });
const policy: CollectionPolicy = { enabled: true, since: new Date(Date.now()-48*3600000).toISOString(), ...DEFAULT_COLLECTION_LIMITS,
  perRun: 2, perHour: 3, perDay: 4, perSourceDay: 2, sourceIds: [A,B] };
let savedPolicy: unknown = undefined;
after(async () => {
  if (savedPolicy !== undefined) {
    await sql`DELETE FROM settings WHERE key='collection.policy'`;
    if (savedPolicy !== null) await sql`INSERT INTO settings(key,value,updated_by) VALUES('collection.policy',${sql.json(savedPolicy as never)},'test-restore')`;
  }
  await sql`DELETE FROM collection_admissions WHERE source_id IN (${A},${B},${R})`;
  await stopBoss(); await closeDb();
});
test("collection windows reject undated, old and far-future material and admit recent revisions", () => {
  assert.equal(withinCollectionWindow({ ...item("old"), publishedAt: new Date(Date.now()-72*3600000) }, policy), false);
  assert.equal(withinCollectionWindow({ ...item("missing"), publishedAt: null }, policy), false);
  assert.equal(withinCollectionWindow({ ...item("future"), publishedAt: new Date(Date.now()+4*3600000) }, policy), false);
  assert.equal(withinCollectionWindow({ ...item("update"), publishedAt: new Date(Date.now()-72*3600000), sourceUpdatedAt: new Date() }, policy), true);
});
test("existing baselines cost no admission and quotas hold across concurrent sources", async () => {
  await sql`INSERT INTO sources(id,name,kind,tier,participation_mode,next_fetch_at) VALUES(${A},'A','rss','T1','editorial','2100-01-01'),(${B},'B','rss','T1','editorial','2100-01-01')`;
  const baseline = item("baseline");
  const old = await upsertMaterial({ sourceId: A, url: baseline.url, title: baseline.title, bodyStatus: "none", via: "import" });
  await sql`UPDATE articles SET processing_state='analyzed' WHERE id=${old.articleId}`;
  const first = await storeControlled(source(A), [baseline,item("a1"),item("a2"),item("a3")], policy);
  assert.deepEqual([first.baseline,first.created,first.limited],[1,2,1]);
  const [before] = await sql`SELECT revision,processing_state FROM articles WHERE id=${old.articleId}`;
  assert.deepEqual([before!.revision,before!.processing_state],[1,"analyzed"]);
  const concurrent = await Promise.all([storeControlled(source(A),[item("a4")],policy),storeControlled(source(B),[item("b1"),item("b2")],policy)]);
  assert.equal(concurrent.reduce((n,r)=>n+r.created,0),1);
  assert.equal((await sql`SELECT count(*)::int AS n FROM collection_admissions WHERE admitted_at>now()-interval '1 hour'`)[0]!.n,3);
  await sql`UPDATE collection_admissions SET admitted_at=now()-interval '2 hours' WHERE source_id IN (${A},${B})`;
  const last = await storeControlled(source(B),[item("b2"),item("b3")],policy);
  assert.equal(last.created,1);
  assert.equal(last.limited,1);
  assert.equal((await sql`SELECT count(*)::int AS n FROM collection_admissions`)[0]!.n,4);
  const roomy = { ...policy, perRun: 5, perHour: 20, perDay: 100, perSourceDay: 20 };
  const changed = await storeControlled(source(A),[{ ...baseline,bodyText:"A genuine subsequent correction" }],roomy);
  assert.equal(changed.revised,1,"later changes remain eligible after an initial baseline");
});
test("quota deferrals disable RSS 304 reuse and a paused policy fails closed", async () => {
  const [saved] = await sql`SELECT value FROM settings WHERE key='collection.policy'`;
  savedPolicy = saved?.value ?? null;
  let validators = 0;
  const server = http.createServer((req,res) => {
    if (req.headers['if-none-match']) { validators++; res.writeHead(304); res.end(); return; }
    const entries = Array.from({length:3},(_,i)=>`<item><title>RSS ${i}</title><link>https://example.org/${T}/rss/${i}</link><pubDate>${new Date().toUTCString()}</pubDate><description>Remote sensing evidence ${i}</description></item>`).join('');
    res.writeHead(200,{'content-type':'application/rss+xml',etag:'"same"'}); res.end(`<rss version="2.0"><channel><title>Test</title>${entries}</channel></rss>`);
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const previousPrivate = config.allowPrivateNetworkFetch; config.allowPrivateNetworkFetch=true;
  try {
    const controlled = { ...policy, sourceIds:[R], perRun:1, perHour:20, perDay:100, perSourceDay:20 };
    await sql`INSERT INTO settings(key,value,updated_by) VALUES('collection.policy',${sql.json(controlled)},'test') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
    const address = server.address() as {port:number};
    await sql`INSERT INTO sources(id,name,kind,config,tier,participation_mode,cursor,next_fetch_at) VALUES(${R},'RSS fixture','rss',${sql.json({feedUrl:`http://127.0.0.1:${address.port}/feed`})},'T1','editorial',NULL,'2100-01-01')`;
    assert.equal((await collectSource(R)).created,1);
    assert.equal((await collectSource(R)).created,1);
    assert.equal(validators,0,"unadmitted feed entries are fetched again rather than lost behind an ETag");
    await sql`UPDATE settings SET value=${sql.json({...controlled,enabled:false})} WHERE key='collection.policy'`;
    assert.equal((await collectSource(R,{force:true})).status,"skipped");
  } finally { config.allowPrivateNetworkFetch=previousPrivate; await new Promise<void>(r=>server.close(()=>r())); }
});
