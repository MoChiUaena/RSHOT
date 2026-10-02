import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { approvedSocialSources, normalizeXPosts, normalizeWechatFeed, ingestFreeSocial } from "../packages/backend/src/sources/free-social.ts";

const databaseEnabled = Boolean(process.env.DATABASE_URL) || process.env.FREE_SOCIAL_DB_TEST === "true";
// Any accidental DB/config initialization fails immediately in the pure test run.
if (!databaseEnabled) process.env.API_PORT = "invalid-pure-test-db-guard";

const now = new Date("2026-10-02T06:00:00Z");
const sources = approvedSocialSources();
const x = sources.find(s => s.id === "free-x-giswqs")!;
const mp = sources.find(s => s.id === "free-mp-gis-frontier")!;
const method = "SamGeo adds a tiled segmentation pipeline with overlap reconciliation, preserving geospatial coordinates and exporting GeoTIFF masks. ";
const post = (extra: Record<string, unknown> = {}) => ({ id: "197000000000000001", text: method, author: { id: "123", name: "Qiusheng Wu", screenName: "giswqs", profileImageUrl: "https://pbs.twimg.com/profile.jpg", verified: false }, createdAtISO: now.toISOString(), createdAt: now.toUTCString(), media: [], urls: [], isRetweet: false, retweetedBy: null, lang: "en", metrics: { likes: 100000 }, ...extra });
const item = (link = "https://mp.weixin.qq.com/s/publicArticle_1", body = method.repeat(3), date = now.toUTCString()) => `<item><title>GeoAI 方法更新</title><link>${link.replaceAll("&", "&amp;")}</link><pubDate>${date}</pubDate><content:encoded><![CDATA[<p>${body}</p>]]></content:encoded></item>`;
const feed = (items: string, title = mp.name) => `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>${title}</title>${items}</channel></rss>`;

test("approved catalog has only the twelve requested identities and returns independent copies", () => {
  assert.equal(sources.length, 12);
  assert.equal(sources.filter(s => s.platform === "x").length, 6);
  assert.equal(sources.filter(s => s.platform === "wechat").length, 6);
  assert.deepEqual(sources.filter(s => s.platform === "x").map(s => s.handle), ["USGSLandsat", "ESA_EO", "CopernicusLand", "CopernicusEMS", "CopernicusEU", "giswqs"]);
  const copy = approvedSocialSources(); copy[0]!.aliases.push("forged");
  assert.ok(!approvedSocialSources()[0]!.aliases.includes("forged"));
  assert.equal(sources.find(s => s.id === "free-x-esa-eo")!.ownerEntityId, "esa");
  assert.equal(sources.find(s => s.id === "free-x-copernicus-eu")!.ownerEntityId, "copernicus");
});

test("twitter-cli array produces canonical matching-author identity and keeps complete evidence", () => {
  const body = method.repeat(100);
  const [c] = normalizeXPosts([post({ text: body, metrics: { likes: 0 } }), post()], x, now);
  assert.equal(c!.url, "https://x.com/giswqs/status/197000000000000001");
  assert.equal(c!.bodyText, body.trim());
  assert.equal(c!.bodyStatus, "ok");
  assert.equal(c!.publishedAt!.toISOString(), now.toISOString());
  assert.equal(c!.author, "Qiusheng Wu");
  assert.equal(c!.language, "en");
  assert.ok(!JSON.stringify(c).includes("likes"));
  const [article] = normalizeXPosts([post({ articleTitle: "New segmentation workflow", articleText: body })], x, now);
  assert.ok(article!.bodyText!.includes(body.trim()));
  assert.equal(article!.title, "New segmentation workflow");
});

test("X rejects reposts, quotes, mismatching authors, incomplete text, credential URLs and invalid dates", () => {
  for (const bad of [
    { isRetweet: true }, { retweetedBy: "giswqs" }, { quotedTweet: post() },
    { author: { name: "Other", screenName: "other" } }, { id: "abc" }, { id: "12/345" },
    { createdAtISO: "" }, { createdAtISO: "invalid" },
    { createdAtISO: new Date(now.getTime() - 48 * 3600000 - 1).toISOString() },
    { createdAtISO: new Date(now.getTime() + 3600000 + 1).toISOString() },
    { text: "read more…" }, { text: method + "…" }, { articleTitle: "Missing full article" },
    { text: method + " https://example.org/tool?access_token=secret" },
    { urls: [{ expandedUrl: "https://user:secret@example.org/" }] },
    { media: [{ url: "https://example.org/image?ticket=secret" }] },
  ]) assert.deepEqual(normalizeXPosts([post(bad)], x, now), [], JSON.stringify(bad));
  assert.equal(normalizeXPosts([post({ author: { name: "Qiusheng Wu", screenName: "GISWQS" } })], x, now).length, 1);
  assert.equal(normalizeXPosts([post({ createdAtISO: new Date(now.getTime() - 48 * 3600000).toISOString() })], x, now).length, 1);
  assert.equal(normalizeXPosts([post({ createdAtISO: new Date(now.getTime() + 3600000).toISOString() })], x, now).length, 1);
});

test("complete X Article can accompany a short announcement and normal public HTTP references", () => {
  const [article] = normalizeXPosts([post({ text: "New method https://t.co/example", articleTitle: "Tiled inference", articleText: method.repeat(4) })], x, now);
  assert.ok(article?.bodyText?.includes("overlap reconciliation"));
  assert.equal(normalizeXPosts([post({ text: method + " http://example.org/paper#methods" })], x, now).length, 1);
  assert.equal(normalizeXPosts([post({ text: method + " //compute tiled windows before reconciliation" })], x, now).length, 1);
  assert.deepEqual(normalizeXPosts([post({ text: method + " //example.org/paper?ticket=private" })], x, now), []);
  const badLanguage = normalizeXPosts([post({ lang: "access_token=private-token" })], x, now);
  assert.ok(!JSON.stringify(badLanguage).includes("private-token"));
});

test("parsers fail safely on wrong shapes, oversized input/count/body and never expose raw error text", () => {
  assert.throws(() => normalizeXPosts({ secret: "private-token" }, x, now), /invalid social input/);
  assert.throws(() => normalizeXPosts(Array.from({ length: 101 }, () => post()), x, now), /social input limit/);
  assert.deepEqual(normalizeXPosts([post({ text: "a".repeat(100001) })], x, now), []);
  assert.throws(() => normalizeWechatFeed("x".repeat(2 * 1024 * 1024 + 1), mp, now), /social input limit/);
  assert.throws(() => normalizeWechatFeed("<rss><channel>private-token</rss>", mp, now), /^Error: invalid social feed$/);
  assert.throws(() => normalizeWechatFeed('<!DOCTYPE rss [<!ENTITY secret "private-token">]><rss><channel><title>GIS前沿</title></channel></rss>', mp, now), /invalid social feed/);
  assert.throws(() => normalizeWechatFeed(feed(item().repeat(101)), mp, now), /social input limit/);
  assert.deepEqual(normalizeWechatFeed(feed(item(undefined, "a".repeat(100001))), mp, now), []);
});

test("WeChat RSS matches verified name/known alias and keeps complete public article/date", () => {
  const body = method.repeat(100);
  const [c] = normalizeWechatFeed(feed(item(undefined, body) + item()), mp, now);
  assert.equal(c!.url, "https://mp.weixin.qq.com/s/publicArticle_1");
  assert.equal(c!.bodyText, body.trim());
  assert.equal(c!.publishedAt!.toISOString(), now.toISOString());
  assert.equal(c!.author, mp.name);
  assert.ok(c!.bodyHtml!.includes("GeoTIFF masks"));
  const aliasSource = sources.find(s => s.id === "free-mp-ygxb")!;
  assert.equal(normalizeWechatFeed(feed(item(), "遥感图像图形"), aliasSource, now).length, 1);
  assert.deepEqual(normalizeWechatFeed(feed(item(), "Wrong account"), mp, now), []);
  const native = "https://mp.weixin.qq.com/s?__biz=MzExample==&mid=123&idx=1&sn=abcdef";
  assert.equal(normalizeWechatFeed(feed(item(native)), mp, now)[0]!.url, native);
  assert.equal(normalizeWechatFeed(feed(item("https://weread.qq.com/reviewdetail/123abc")), mp, now).length, 1);
});

test("WeChat retains complete text when verbose layout HTML exceeds 100,000 characters", () => {
  const body = method.repeat(3);
  const layout = `<span data-layout="${"x".repeat(120)}"></span>`.repeat(850);
  const [candidate] = normalizeWechatFeed(feed(item(undefined, `${layout}${body}`)), mp, now);
  assert.equal(candidate?.bodyText, body.trim());
  assert.equal(candidate?.bodyStatus, "ok");
});

test("WeChat accepts sanitized HTML above 100,000 characters with short complete text", async () => {
  const body = method.repeat(3);
  const layout = "<span></span>".repeat(8500);
  const [candidate] = normalizeWechatFeed(feed(item(undefined, `<p>${layout}${body}</p>`)), mp, now);
  assert.ok(candidate!.bodyHtml!.length > 100000);
  assert.equal(candidate!.bodyText, body.trim());
  if (!databaseEnabled) {
    await assert.rejects(ingestFreeSocial(mp.id, [{ ...candidate!, publishedAt: new Date() }]), /^Error: social database unavailable$/);
  }
});

test("WeChat rejects sanitized HTML expanded beyond 2 MiB", () => {
  const html = '<a href="/x">a</a>'.repeat(52000);
  assert.deepEqual(normalizeWechatFeed(feed(item(undefined, html)), mp, now), []);
});

test("WeChat counts UTF-8 bytes when sanitized HTML expands past 2 MiB", () => {
  const html = '<a href="/x">中</a>'.repeat(49000);
  assert.equal(normalizeWechatFeed(feed(item(undefined, html)), mp, now).length, 0);
});

test("WeChat rejects books, notebooks, other domains, auth links and untraceable or incomplete entries", () => {
  for (const url of ["https://weread.qq.com/", "https://weread.qq.com/web/bookDetail/123", "https://weread.qq.com/notebook/123", "https://weread.qq.com/bookshelf", "https://weread.qq.com/reviewdetail/123?token=private", "https://mp.weixin.qq.com/s/abc?ticket=private", "https://mp.weixin.qq.com/s/abc?auth=private", "https://mp.weixin.qq.com/s?__biz=123&mid=1", "http://mp.weixin.qq.com/s/abc", "https://mp.weixin.qq.com.evil.org/s/abc", "https://user:secret@mp.weixin.qq.com/s/abc", "https://example.org/s/abc"])
    assert.deepEqual(normalizeWechatFeed(feed(item(url)), mp, now), [], url);
  assert.deepEqual(normalizeWechatFeed(feed(item(undefined, "Read full article…")), mp, now), []);
  assert.deepEqual(normalizeWechatFeed(feed(item(undefined, method + ' <a href="https://example.org/?ticket=private">tool</a>')), mp, now), []);
  assert.deepEqual(normalizeWechatFeed(feed(item(undefined, undefined, "")), mp, now), []);
  assert.deepEqual(normalizeWechatFeed(feed(item(undefined, undefined, new Date(now.getTime() - 49 * 3600000).toUTCString())), mp, now), []);
  for (const url of ["https://mp.weixin.qq.com/s?__biz=safe%26auth_token%3Dprivate&mid=1&idx=1&sn=abc", "https://mp.weixin.qq.com/s?__biz=safe&mid=1&mid=2&idx=1&sn=abc", "https://mp.weixin.qq.com/s/abc?%61uth=private"])
    assert.deepEqual(normalizeWechatFeed(feed(item(url)), mp, now), [], url);
  assert.deepEqual(normalizeWechatFeed(feed(item().replace("</item>", "<dc:creator>Wrong account</dc:creator></item>")), mp, now), []);
  assert.throws(() => normalizeWechatFeed(feed(item()), { ...mp, name: "Wrong account" }, now), /unapproved social source/);
});

test("pure parser import does not load backend DB or runtime configuration", () => {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `import {normalizeXPosts} from './packages/backend/src/sources/free-social.ts'; console.log(normalizeXPosts([], ${JSON.stringify(x)}).length)`], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: "invalid", API_PORT: "invalid", AIHOT_CREDENTIALS_DIR: "/nonexistent-test-credentials" }, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), "0");
});

test("ingestion rejects unknown source and invalid material before initializing DB", async () => {
  await assert.rejects(ingestFreeSocial("unknown-source", []), /^Error: unapproved social source$/);
  const c = normalizeXPosts([post()], x, now)[0]!;
  for (const bad of [ { ...c, url: "https://x.com/other/status/123" }, { ...c, identityKey: "forged" }, { ...c, bodyText: method + " https://example.org/?auth_token=private" }, { ...c, publishedAt: null }, { ...c, publishedAt: new Date("invalid") }, { ...c, xPost: { ...c.xPost!, tweetId: "123", handle: "other" } }, { ...c, language: "private-token" } ])
    await assert.rejects(ingestFreeSocial(x.id, [bad]), /^Error: invalid social candidate$/);
  const w = normalizeWechatFeed(feed(item()), mp, now)[0]!;
  await assert.rejects(ingestFreeSocial(mp.id, [{ ...w, author: "Wrong account" }]), /^Error: invalid social candidate$/);
});

test("ingestion rejects credentials introduced by relative HTML resolution before DB initialization", () => {
  const candidate = { url: "https://mp.weixin.qq.com/s/publicArticle_1", title: "GeoAI 方法更新", author: mp.name, language: "zh", bodyStatus: "ok",
    bodyText: `${method.trim()} Tool`, bodyHtml: `<p>${method.trim()}</p><p><a href="/tool?ticket=synthetic-relative-marker">Tool</a></p>` };
  const script = `import {ingestFreeSocial} from './packages/backend/src/sources/free-social.ts';
    try { await ingestFreeSocial(${JSON.stringify(mp.id)}, [{...${JSON.stringify(candidate)}, publishedAt: new Date()}]); console.log(JSON.stringify({resolved: true})); }
    catch (error) { console.log(JSON.stringify({name: error.name, message: error.message})); }`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: process.cwd(), timeout: 10000,
    env: { ...process.env, DATABASE_URL: "invalid", API_PORT: "invalid-before-db-guard", AIHOT_CREDENTIALS_DIR: "/nonexistent-test-credentials", MODEL_CALLS_ENABLED: "false", COLLECT_ENABLED: "false" }, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), {name: "Error", message: "invalid social candidate"});
});

test("ingestion sanitizes dynamic DB import failures without retaining malformed URL credentials", () => {
  const marker = "synthetic-import-marker";
  const candidate = { url: "https://x.com/giswqs/status/197000000000000001", title: "Tiled segmentation", author: "Qiusheng Wu", language: "en", bodyStatus: "ok", bodyText: method.trim() };
  const script = `import {ingestFreeSocial} from './packages/backend/src/sources/free-social.ts';
    try { await ingestFreeSocial(${JSON.stringify(x.id)}, [{...${JSON.stringify(candidate)}, publishedAt: new Date()}]); console.log(JSON.stringify({resolved: true})); }
    catch (error) { const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
      console.log(JSON.stringify({name: error.name, message: error.message, hasMarker: serialized.includes(${JSON.stringify(marker)}), hasCause: Object.hasOwn(error, 'cause'), hasInput: Object.hasOwn(error, 'input')})); }`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: process.cwd(), timeout: 10000,
    env: { ...process.env, DATABASE_URL: `postgres://synthetic-user:${marker}@[`, API_PORT: "3001", AIHOT_CREDENTIALS_DIR: "/nonexistent-test-credentials", MODEL_CALLS_ENABLED: "false", COLLECT_ENABLED: "false" }, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.hasMarker, false, "safe errors must not retain connection URL credentials");
  assert.deepEqual(result, {name: "Error", message: "social database unavailable", hasMarker: false, hasCause: false, hasInput: false});
});

test("isolated DB: fail-closed source/policy, controlled quotas, duplicate identity and queued processing", { skip: !databaseEnabled }, async () => {
  await import("./setup.ts");
  const { sql, closeDb } = await import("../packages/backend/src/db.ts");
  const { stopBoss } = await import("../packages/backend/src/jobs/queue.ts");
  const { config } = await import("../packages/backend/src/config.ts");
  assert.equal(config.modelCallsEnabled, false);
  const ids = ["free-x-giswqs", "free-x-usgs-landsat"];
  const globalSource = `free-social-quota-${Date.now()}`;
  const [saved] = await sql`SELECT value FROM settings WHERE key='collection.policy'`;
  const [receiptsBefore] = await sql`SELECT count(*)::int AS n FROM receipts`;
  assert.equal((await sql`SELECT count(*)::int AS n FROM sources WHERE id IN (${ids[0]!},${ids[1]!})`)[0]!.n, 0, "test sources must not preexist");
  const live = new Date();
  const candidate = (id: number, source = x) => normalizeXPosts([post({ id: String(198000000000000000n + BigInt(id)), createdAtISO: live.toISOString(), author: { name: source.name, screenName: source.handle } })], source, live)[0]!;
  const policy = { enabled: true, since: new Date(live.getTime()-48*3600000).toISOString(), maxAgeHours: 48, perRun: 2, perHour: 4, perDay: 10, perSourceDay: 3, sourceIds: ids };
  const setPolicy = async (value: typeof policy) => { await sql`INSERT INTO settings(key,value,updated_by) VALUES('collection.policy',${sql.json(value)},'free-social-test') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`; };
  try {
    await sql`DELETE FROM settings WHERE key='collection.policy'`;
    await assert.rejects(ingestFreeSocial(x.id, [candidate(1)]), /social source unavailable/);
    await sql`INSERT INTO sources(id,name,kind,tier,participation_mode,enabled,next_fetch_at) VALUES(${x.id},${x.name},'external',${x.tier},'editorial',false,'2100-01-01')`;
    await setPolicy(policy);
    await assert.rejects(ingestFreeSocial(x.id, [candidate(1)]), /social source unavailable/);
    await sql`UPDATE sources SET enabled=true,kind='rss' WHERE id=${x.id}`;
    await assert.rejects(ingestFreeSocial(x.id, [candidate(1)]), /social source unavailable/);
    await sql`UPDATE sources SET kind='external',participation_mode='hot_signal' WHERE id=${x.id}`;
    await assert.rejects(ingestFreeSocial(x.id, [candidate(1)]), /social source unavailable/);
    await sql`UPDATE sources SET participation_mode='editorial' WHERE id=${x.id}`;
    await sql`DELETE FROM settings WHERE key='collection.policy'`;
    await assert.rejects(ingestFreeSocial(x.id, [candidate(1)]), /social collection unavailable/);
    await setPolicy({ ...policy, enabled: false });
    await assert.rejects(ingestFreeSocial(x.id, [candidate(1)]), /social collection unavailable/);
    await setPolicy({ ...policy, sourceIds: [ids[1]!] });
    await assert.rejects(ingestFreeSocial(x.id, [candidate(1)]), /social collection unavailable/);
    await setPolicy(policy);
    await assert.rejects(ingestFreeSocial(x.id, [candidate(1), { ...candidate(2), url: 'https://example.org/forged' }]), /invalid social candidate/);
    assert.equal((await sql`SELECT count(*)::int AS n FROM articles WHERE source_id=${x.id}`)[0]!.n, 0);
    const first = await ingestFreeSocial(x.id, [candidate(1),candidate(2),candidate(3)]);
    assert.deepEqual([first.created,first.limited], [2,1]);
    assert.equal((await ingestFreeSocial(x.id, [candidate(1)])).unchanged, 1);
    const second = await ingestFreeSocial(x.id, [candidate(3),candidate(4)]);
    assert.deepEqual([second.created,second.limited], [1,1]);
    const usgs = sources.find(s => s.id === ids[1])!;
    await sql`INSERT INTO sources(id,name,kind,tier,participation_mode,enabled,next_fetch_at) VALUES(${usgs.id},${usgs.name},'external',${usgs.tier},'editorial',true,'2100-01-01')`;
    const other = await ingestFreeSocial(usgs.id, [candidate(5,usgs),candidate(6,usgs)]);
    assert.deepEqual([other.created,other.limited], [1,1]);
    assert.equal((await sql`SELECT count(*)::int AS n FROM collection_admissions WHERE source_id IN (${ids[0]!},${ids[1]!})`)[0]!.n,4);
    const rows = await sql`SELECT a.published_at,a.processing_state,j.name FROM articles a JOIN pgboss.job j ON j.data->>'articleId'=a.id WHERE a.source_id IN (${ids[0]!},${ids[1]!})`;
    assert.equal(rows.length,4);
    assert.ok(rows.every(r => new Date(r.published_at).getTime() === live.getTime()));
    assert.ok(rows.every(r => r.name === "content.analyze"));
    assert.equal((await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n, receiptsBefore!.n);
    await sql`UPDATE collection_admissions SET admitted_at=now()-interval '2 hours' WHERE source_id IN (${ids[0]!},${ids[1]!})`;
    const changed = { ...candidate(1,usgs), bodyText: method + "The revised tool now supports multi-resolution export with consistent nodata masks." };
    assert.equal((await ingestFreeSocial(usgs.id, [changed])).baseline, 1, "same post identity cannot create independent cross-source evidence");
    assert.equal((await ingestFreeSocial(usgs.id, [candidate(6,usgs),candidate(7,usgs),candidate(8,usgs)])).created, 2);
    assert.equal((await ingestFreeSocial(usgs.id, [candidate(9,usgs)])).limited, 1, "rolling per-source day cap");
    // Existing global admissions count, including other sources, on a rolling 24h window.
    await sql`UPDATE collection_admissions SET admitted_at=now()-interval '25 hours' WHERE source_id IN (${ids[0]!},${ids[1]!})`;
    await sql`INSERT INTO sources(id,name,kind,next_fetch_at) VALUES(${globalSource},'Other fixture','external','2100-01-01')`;
    const [existing] = await sql`SELECT id FROM articles WHERE source_id=${x.id} LIMIT 1`;
    for (let n = 0; n < 9; n++) await sql`INSERT INTO collection_admissions(source_id,article_id,input_revision,admitted_at) VALUES(${globalSource},${existing!.id},${100+n},now()-interval '2 hours')`;
    const daily = await ingestFreeSocial(usgs.id, [candidate(10,usgs),candidate(11,usgs)]);
    assert.deepEqual([daily.created,daily.limited], [1,1]);
    await setPolicy({ ...policy, perRun: 10, perHour: 20, perDay: 100, perSourceDay: 20 });
    assert.equal((await ingestFreeSocial(usgs.id, [candidate(12,usgs)])).limited, 1, "larger policy cannot raise initial daily cap");
  } finally {
    await sql`DELETE FROM pgboss.job WHERE data->>'articleId' IN (SELECT id FROM articles WHERE source_id IN (${ids[0]!},${ids[1]!}))`;
    await sql`DELETE FROM collection_admissions WHERE source_id IN (${ids[0]!},${ids[1]!},${globalSource})`;
    await sql`DELETE FROM collection_observations WHERE source_id IN (${ids[0]!},${ids[1]!})`;
    await sql`DELETE FROM articles WHERE source_id IN (${ids[0]!},${ids[1]!})`;
    await sql`DELETE FROM sources WHERE id IN (${ids[0]!},${ids[1]!},${globalSource})`;
    await sql`DELETE FROM settings WHERE key='collection.policy'`;
    if (saved) await sql`INSERT INTO settings(key,value,updated_by) VALUES('collection.policy',${sql.json(saved.value)},'free-social-restore')`;
    await stopBoss(); await closeDb();
  }
});
