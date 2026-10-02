import { readFile, realpath, stat, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { X509Certificate } from 'node:crypto';
import { createConnection } from 'node:net';
import { approvedSocialSources, normalizeXPosts, wechatFeedReferences, ingestFreeSocial, type FreeSocialSource } from '../../packages/backend/src/sources/free-social.ts';
import type { Candidate } from '../../packages/backend/src/sources/types.ts';
import { CollectionPolicySchema } from '../../packages/backend/src/sources/collection-policy.ts';
import { normalizeWechatOriginal } from './wechat-original.ts';

const REPO = path.resolve(import.meta.dirname, '../..');
const CAP = 2 * 1024 * 1024;
const FEED_ID = /^MP_WXS_[0-9]+$/;
export const disabledSocialFlags = { MODEL_CALLS_ENABLED: 'false', COLLECT_ENABLED: 'false', FEISHU_CONTENT_PUSH_ENABLED: 'false', FEISHU_ENABLED: 'false', INDEXNOW_SUBMIT_ENABLED: 'false' };
interface Entry { sourceId: string; verified: boolean; verifiedAt?: string; feedId?: string }
interface Profiles { version: 1; twitter?: { executable: string; credentialsFile: string }; werss?: { credentialsFile: string }; sources: Entry[] }
export interface LoadedProfiles { status: 'ready' | 'not-configured' | 'invalid-profile' }
export interface ReadResult { sourceId: string; status: 'unverified' | 'needs-auth' | 'needs-dependency' | 'read-failed' | 'empty' | 'ok'; candidates: Candidate[]; operation?: 'registered' | 'applied' | 'operation-rejected' }
const privateProfiles = new WeakMap<LoadedProfiles, Profiles>();
const currentSamples = new WeakMap<ReadResult[], { profiles: LoadedProfiles; signature: string }>();
function sampleSignature(results: ReadResult[]): string { return JSON.stringify(results.map(r=>({sourceId:r.sourceId,status:r.status,candidates:r.candidates}))); }
interface Transport { root: string; childScript?: string; childTimeoutMs?: number; port?: number; proxyPort?: number; werssRefreshTimeoutMs?: number; werssPollIntervalMs?: number; werssOriginalTimeoutMs?: number; werssOriginalDeadlineMs?: number }
const fixtures = new WeakMap<object, Transport>();
function inside(file: string, root: string): boolean { const rel = path.relative(root, file); return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel); }
function same(a: string, b: string): boolean { return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; }
function obj(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }
function keys(v: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(v).every(k => allowed.includes(k)); }
async function safePath(file: string): Promise<void> {
  if (!path.isAbsolute(file) || inside(file, REPO) || same(file, REPO)) throw new Error('unsafe-private-path');
  // Check existing ancestors too: missing files must not bypass symlink/junction checks.
  let cursor = path.resolve(file);
  while (true) {
    try { const resolved = await realpath(cursor); if (!same(resolved, cursor)) throw new Error('unsafe-private-path'); break; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('unsafe-private-path'); }
    const parent = path.dirname(cursor); if (parent === cursor) throw new Error('unsafe-private-path'); cursor = parent;
  }
}
export function defaultProfilesPath(): string { return path.resolve(REPO, '../RSHOT-private/social/profiles.json'); }
export async function loadProfiles(file: string): Promise<LoadedProfiles> {
  try {
    await safePath(file);
    let raw: string;
    try { if ((await stat(file)).size > 65536) throw new Error('invalid-profile'); raw = await readFile(file, 'utf8'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'not-configured' }; throw e; }
    const p: unknown = JSON.parse(raw.replace(/^\uFEFF/, ''));
    if (!obj(p) || !keys(p, ['version','twitter','werss','sources']) || p.version !== 1 || !Array.isArray(p.sources) || p.sources.length > 12) throw new Error('invalid-profile');
    const social = path.dirname(file), privateRoot = path.dirname(social);
    if (p.twitter !== undefined) {
      if (!obj(p.twitter) || !keys(p.twitter,['executable','credentialsFile']) || typeof p.twitter.executable !== 'string' || typeof p.twitter.credentialsFile !== 'string') throw new Error('invalid-profile');
      const executable = path.join(privateRoot,'twitter-venv',process.platform === 'win32' ? 'Scripts/twitter.exe' : 'bin/twitter');
      if (!same(path.resolve(p.twitter.executable), executable) || !path.isAbsolute(p.twitter.executable) || !same(p.twitter.credentialsFile,path.join(social,'collectors.env'))) throw new Error('invalid-profile');
      await safePath(p.twitter.executable); await safePath(p.twitter.credentialsFile);
    }
    if (p.werss !== undefined) {
      if (!obj(p.werss) || !keys(p.werss,['credentialsFile']) || typeof p.werss.credentialsFile !== 'string' || !same(p.werss.credentialsFile,path.join(social,'werss.env'))) throw new Error('invalid-profile');
      await safePath(p.werss.credentialsFile);
    }
    const seen = new Set<string>();
    for (const s of p.sources) {
      if (!obj(s) || !keys(s,['sourceId','verified','verifiedAt','feedId']) || typeof s.sourceId !== 'string' || typeof s.verified !== 'boolean' || seen.has(s.sourceId)) throw new Error('invalid-profile');
      const source = approvedSocialSources().find(a => a.id === s.sourceId);
      if (!source || (s.verifiedAt !== undefined && (typeof s.verifiedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(s.verifiedAt) || !Number.isFinite(Date.parse(s.verifiedAt)))) ||
          (s.feedId !== undefined && (source.platform !== 'wechat' || typeof s.feedId !== 'string' || !FEED_ID.test(s.feedId)))) throw new Error('invalid-profile');
      seen.add(s.sourceId);
    }
    const loaded: LoadedProfiles = { status: 'ready' }; privateProfiles.set(loaded,p as unknown as Profiles); return loaded;
  } catch { return { status: 'invalid-profile' }; }
}

// Explicit fixture capability: valid only in test processes, with scripts/profiles under a real temp directory.
export async function fixtureTransport(root: string, options: Omit<Transport,'root'>): Promise<object> {
  if (process.env.NODE_ENV !== 'test' || process.env.SOCIAL_READER_TEST !== '1' || !keys(options,['childScript','childTimeoutMs','port','proxyPort','werssRefreshTimeoutMs','werssPollIntervalMs','werssOriginalTimeoutMs','werssOriginalDeadlineMs']) || !inside(root,tmpdir()) || !path.basename(root).startsWith('rshot-social-reader-')) throw new Error('fixture-only');
  await safePath(root);
  if (options.childScript) { if (!inside(options.childScript,root) || !options.childScript.endsWith('.cjs')) throw new Error('fixture-only'); await safePath(options.childScript); }
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535 || options.port === 8041)) throw new Error('fixture-only');
  if (options.proxyPort !== undefined && (!Number.isInteger(options.proxyPort) || options.proxyPort < 1024 || options.proxyPort > 65535 || options.proxyPort === 7897)) throw new Error('fixture-only');
  if (options.childTimeoutMs !== undefined && (options.childTimeoutMs < 1 || options.childTimeoutMs > 60000)) throw new Error('fixture-only');
  if (options.werssRefreshTimeoutMs !== undefined && (!Number.isInteger(options.werssRefreshTimeoutMs) || options.werssRefreshTimeoutMs < 1 || options.werssRefreshTimeoutMs > 60000)) throw new Error('fixture-only');
  if (options.werssPollIntervalMs !== undefined && (!Number.isInteger(options.werssPollIntervalMs) || options.werssPollIntervalMs < 1 || options.werssPollIntervalMs > 1000)) throw new Error('fixture-only');
  if (options.werssOriginalTimeoutMs !== undefined && (!Number.isInteger(options.werssOriginalTimeoutMs) || options.werssOriginalTimeoutMs < 1 || options.werssOriginalTimeoutMs > 45000)) throw new Error('fixture-only');
  if (options.werssOriginalDeadlineMs !== undefined && (!Number.isInteger(options.werssOriginalDeadlineMs) || options.werssOriginalDeadlineMs < 1 || options.werssOriginalDeadlineMs > 120000)) throw new Error('fixture-only');
  const capability = {}; fixtures.set(capability,{ ...options,root }); return capability;
}
async function credentials(file: string | undefined, names: string[]): Promise<Record<string,string> | null> {
  if (!file) return null;
  try {
    await safePath(file); if ((await stat(file)).size > 65536) return null;
    const env = parseEnv((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
    if (!names.every(k => env[k]?.trim() && !/[\r\n\0]/.test(env[k]))) return null;
    return Object.fromEntries(names.map(k => [k,env[k]!]));
  } catch { return null; }
}
async function childJson(executable: string, args: string[], env: Record<string,string>, timeout: number): Promise<unknown> {
  return new Promise((resolve,reject) => {
    const child = spawn(executable,args,{ shell: false, windowsHide: true, stdio: ['ignore','pipe','pipe'], env });
    let bytes = 0, failed = false; const chunks: Buffer[] = [];
    const fail = () => { failed = true; chunks.length = 0; child.kill(); reject(new Error('child-read-failed')); };
    const timer = setTimeout(fail,timeout);
    child.stdout.on('data',(chunk: Buffer) => { bytes += chunk.length; if (bytes > CAP) fail(); else if (!failed) chunks.push(chunk); });
    // Drain and discard; never retain or log private subprocess diagnostics.
    child.stderr.on('data',()=>{});
    child.on('error',fail);
    child.on('close',code => { clearTimeout(timer); if (failed) return; if (code !== 0) { fail(); return; } try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { fail(); } });
  });
}
async function boundedFetch(url: string, options: RequestInit, timeoutMs = 10000): Promise<string> {
  const response = await fetch(url,{ ...options, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('local-read-failed'); }
  const reader = response.body.getReader(); let bytes = 0; const chunks: Uint8Array[] = [];
  try { while (true) { const { done,value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > CAP) { await reader.cancel(); throw new Error('local-read-failed'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
function childEnvironment(auth: Record<string,string>): Record<string,string> {
  // Whitelist only OS runtime variables; no inherited provider keys, browser profile flags or proxies.
  const env: Record<string,string> = {};
  for (const k of ['SystemRoot','WINDIR','TEMP','TMP','PATH','HOME','USERPROFILE','APPDATA','LOCALAPPDATA']) if (process.env[k]) env[k] = process.env[k]!;
  return { ...env,...auth,...disabledSocialFlags,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8' };
}
async function publicCa(root = homedir()): Promise<string | null> {
  const file=path.join(root,'.rshot-social-public/cacert.pem');
  try {
    if (!/^[\x20-\x7e]+$/.test(file)) return null;
    await safePath(file); const info=await stat(file); if (!info.isFile() || info.size>CAP) return null;
    const text=await readFile(file,'utf8'), first=text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
    if (!first || !new X509Certificate(first[0]).ca) return null; return file;
  } catch {return null;}
}
async function localProxy(port: number | undefined): Promise<string | null> {
  if (!port) return null;
  return new Promise(resolve=>{
    const socket=createConnection({host:'127.0.0.1',port});
    const finish=(ready:boolean)=>{socket.destroy();resolve(ready?`http://127.0.0.1:${port}`:null);};
    socket.setTimeout(300);socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.once('timeout',()=>finish(false));
  });
}
function xPayload(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (!obj(input) || !keys(input,['ok','schema_version','data']) || input.ok!==true || (input.schema_version!=='1' && input.schema_version!==1) || !Array.isArray(input.data)) throw new Error('child-read-failed');
  return input.data;
}
function wechatSyncTime(input: unknown, feedId: string, source: FreeSocialSource): number {
  if (!obj(input) || input.code !== 0 || !obj(input.data) || input.data.id !== feedId ||
      typeof input.data.mp_name !== 'string' || ![source.name,...source.aliases].includes(input.data.mp_name) ||
      typeof input.data.sync_time !== 'number' || !Number.isSafeInteger(input.data.sync_time) || input.data.sync_time < 0 ||
      input.data.sync_time > Math.floor(Date.now() / 1000) + 60) throw new Error('local-read-failed');
  return input.data.sync_time;
}
export async function collectSocial(loaded: LoadedProfiles, capability?: object): Promise<ReadResult[]> {
  const profiles = privateProfiles.get(loaded); if (!profiles) return [];
  const fixture = capability ? fixtures.get(capability) : undefined;
  if (capability && (!fixture || process.env.NODE_ENV !== 'test' || process.env.SOCIAL_READER_TEST !== '1' ||
    profiles.twitter && !inside(profiles.twitter.credentialsFile,fixture.root) || profiles.werss && !inside(profiles.werss.credentialsFile,fixture.root))) throw new Error('fixture-only');
  const out: ReadResult[] = [];
  for (const entry of profiles.sources) {
    const source = approvedSocialSources().find(s=>s.id===entry.sourceId)!;
    const result: ReadResult = { sourceId: source.id,status: 'unverified',candidates: [] }; out.push(result);
    if (!entry.verified) continue;
    const auth = source.platform === 'x' ? await credentials(profiles.twitter?.credentialsFile,['TWITTER_AUTH_TOKEN','TWITTER_CT0']) : await credentials(profiles.werss?.credentialsFile,['USERNAME','PASSWORD']);
    if (!auth) { result.status = 'needs-auth'; continue; }
    try {
      if (source.platform === 'x') {
        const exe = profiles.twitter!.executable; await safePath(exe);
        if (fixture?.childScript) await safePath(fixture.childScript);
        if (!fixture?.childScript) { try { if (!(await stat(exe)).isFile()) throw new Error(); } catch { result.status = 'needs-dependency'; continue; } }
        const ca=await publicCa(fixture?.root); if (!ca) {result.status='needs-dependency';continue;}
        const proxy=await localProxy(fixture?fixture.proxyPort:7897);
        const env={...childEnvironment(auth),CURL_CA_BUNDLE:ca,SSL_CERT_FILE:ca,...(proxy?{TWITTER_PROXY:proxy}:{})};
        const args = ['user-posts',source.handle!,'-n','5','--json'];
        const input = await childJson(fixture?.childScript ? process.execPath : exe, fixture?.childScript ? [fixture.childScript,...args] : args, env,fixture?.childTimeoutMs ?? 60000);
        result.candidates = normalizeXPosts(xPayload(input),source);
      } else {
        if (!entry.feedId || !FEED_ID.test(entry.feedId)) { result.status = 'needs-dependency'; continue; }
        const base = `http://127.0.0.1:${fixture?.port ?? 8041}`;
        const login: unknown = JSON.parse(await boundedFetch(`${base}/api/v1/wx/auth/login`,{ method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ username:auth.USERNAME,password:auth.PASSWORD }) }));
        const token = obj(login) ? (obj(login.data) ? login.data.access_token ?? login.access_token : login.access_token) : undefined;
        if (typeof token !== 'string' || !token || token.length > 8192 || /[\r\n\0]/.test(token)) throw new Error('local-read-failed');
        const headers = { authorization:`Bearer ${token}` };
        const syncTime = async (timeoutMs = 10000) => wechatSyncTime(JSON.parse(await boundedFetch(`${base}/api/v1/wx/mps/${entry.feedId}`,{ headers },timeoutMs)),entry.feedId!,source);
        const baseline = await syncTime(), startedAt = Date.now();
        const deadline = startedAt + (fixture?.werssRefreshTimeoutMs ?? 60000);
        const remaining = () => { const milliseconds = deadline - Date.now(); if (milliseconds <= 0) throw new Error('local-read-failed'); return milliseconds; };
        const refresh: unknown = JSON.parse(await boundedFetch(`${base}/api/v1/wx/mps/update/${entry.feedId}?start_page=0&end_page=1`,{ headers },remaining()));
        const refreshCode = obj(refresh) ? refresh.code : undefined;
        if (refreshCode !== 0 && refreshCode !== 40402) throw new Error('local-read-failed');
        if (refreshCode === 0) {
          while (true) {
            const current = await syncTime(Math.min(10000,remaining()));
            remaining();
            if (current > baseline && current >= Math.floor(startedAt / 1000)) break;
            await new Promise<void>(resolve => setTimeout(resolve,Math.min(fixture?.werssPollIntervalMs ?? 1000,remaining())));
          }
        } else if (await syncTime(Math.min(10000,remaining())) < Math.floor(Date.now() / 1000) - 60) throw new Error('local-read-failed');
        const xml = await boundedFetch(`${base}/rss/${entry.feedId}?is_update=true`,{ headers });
        const rssReferences = wechatFeedReferences(xml,source).slice(0,3);
        if (refreshCode === 40402 && rssReferences.length === 0) throw new Error('local-read-failed');
        const originalDeadline = Date.now() + (fixture?.werssOriginalDeadlineMs ?? 120000);
        const originalRemaining = () => { const milliseconds = originalDeadline - Date.now(); if (milliseconds <= 0) throw new Error('local-read-failed'); return milliseconds; };
        for (const reference of rssReferences) {
          if (!/^https:\/\/mp\.weixin\.qq\.com\/s\/[A-Za-z0-9_-]{1,128}$/.test(reference.url)) throw new Error('local-read-failed');
          const originalStartedAt = new Date();
          const payload: unknown = JSON.parse(await boundedFetch(`${base}/api/v1/wx/mps/by_article?url=${encodeURIComponent(reference.url)}`,{ method:'POST',headers },Math.min(fixture?.werssOriginalTimeoutMs ?? 45000,originalRemaining())));
          originalRemaining();
          const original = normalizeWechatOriginal(reference,payload,entry.feedId,source,new Date(),originalStartedAt);
          if (original) result.candidates.push(original);
        }
      }
      result.status = result.candidates.length ? 'ok' : 'empty';
    } catch { result.candidates = []; result.status = 'read-failed'; }
  }
  currentSamples.set(out,{profiles:loaded,signature:sampleSignature(out)}); return out;
}
export function publicResults(results: ReadResult[]) {
  return results.map(r=>({ sourceId:r.sourceId,status:r.status,count:r.candidates.length,...(r.operation ? {operation:r.operation}:{}),items:r.candidates.map(c=>({title:c.title,date:c.publishedAt?.toISOString(),url:c.url})) }));
}
export async function socialReadiness(loaded: LoadedProfiles): Promise<boolean> {
  const p = privateProfiles.get(loaded); if (!p || !p.sources.some(s=>s.verified)) return false;
  for (const s of p.sources.filter(s=>s.verified)) {
    const source = approvedSocialSources().find(a=>a.id===s.sourceId)!;
    if (source.platform==='x') { if (!await credentials(p.twitter?.credentialsFile,['TWITTER_AUTH_TOKEN','TWITTER_CT0']) || !await publicCa()) return false; try { await safePath(p.twitter!.executable); if (!(await stat(p.twitter!.executable)).isFile()) return false; } catch { return false; } }
    else if (!s.feedId || !await credentials(p.werss?.credentialsFile,['USERNAME','PASSWORD'])) return false;
  }
  return true;
}
export async function operateSocial(loaded: LoadedProfiles,results: ReadResult[],mode: 'register' | 'apply'): Promise<void> {
  const profiles = privateProfiles.get(loaded);
  const sampled = currentSamples.get(results);
  if (!profiles || sampled?.profiles!==loaded || sampled.signature!==sampleSignature(results)) throw new Error('operation-rejected');
  // Configuration imports in DB paths cannot activate provider calls in this adapter.
  Object.assign(process.env,disabledSocialFlags);
  for (const r of results) {
    const entry = profiles.sources.find(s=>s.sourceId===r.sourceId);
    if (r.status !== 'ok' || !r.candidates.length || !entry?.verified) continue;
    try {
      if (mode==='apply') { await ingestFreeSocial(r.sourceId,r.candidates); r.operation='applied'; continue; }
      if (!entry.verifiedAt || Date.parse(entry.verifiedAt)>Date.now()) throw new Error('operation-rejected');
      const { sql } = await import('../../packages/backend/src/db.ts');
      const source = approvedSocialSources().find(s=>s.id===r.sourceId)!;
      await sql.begin(async tx=>{
        await tx`SELECT pg_advisory_xact_lock(hashtext('rshot.collection.admission'))`;
        const [row] = await tx`SELECT value FROM settings WHERE key='collection.policy' FOR UPDATE`;
        const policy = CollectionPolicySchema.parse(row?.value);
        if (!policy.enabled) throw new Error('operation-rejected');
        // ON CONFLICT does not overwrite manual rows; incompatible existing rows fail registration.
        await tx`INSERT INTO sources(id,name,kind,config,tier,owner_entity_id,participation_mode,enabled,site_fulltext,syndicate_fulltext,next_fetch_at)
          VALUES(${source.id},${source.name},'external',${tx.json({})},${source.tier},${source.ownerEntityId},'editorial',true,false,false,'2100-01-01') ON CONFLICT(id) DO NOTHING`;
        const [existing] = await tx`SELECT * FROM sources WHERE id=${source.id} FOR UPDATE`;
        if (!existing?.enabled || existing.kind!=='external' || existing.participation_mode!=='editorial' || existing.name!==source.name || existing.tier!==source.tier || existing.owner_entity_id!==source.ownerEntityId || existing.site_fulltext!==false || existing.syndicate_fulltext!==false || Object.keys(existing.config ?? {}).length) throw new Error('operation-rejected');
        const updated = CollectionPolicySchema.parse({ ...policy,sourceIds:[...new Set([...policy.sourceIds,source.id])] });
        await tx`UPDATE settings SET value=${tx.json(updated)},updated_by='free-social-register',updated_at=now() WHERE key='collection.policy'`;
      });
      r.operation='registered';
    } catch { r.operation='operation-rejected'; }
  }
}
export async function saveHealth(results: ReadResult[]): Promise<void> {
  if (!currentSamples.has(results) || results.some(r=>!approvedSocialSources().some(s=>s.id===r.sourceId))) throw new Error('invalid-health');
  const directory = path.join(REPO,'.data/social-source-runs'); await mkdir(directory,{recursive:true});
  for (const r of results) {
    const file = path.join(directory,`${r.sourceId}.json`);
    let lastSuccess: string | null = null;
    try { const old = JSON.parse(await readFile(file,'utf8')); if (typeof old.lastSuccess==='string' && Number.isFinite(Date.parse(old.lastSuccess))) lastSuccess=old.lastSuccess; } catch { /* No previous health. */ }
    await writeFile(file,JSON.stringify({sourceId:r.sourceId,status:r.status,count:r.candidates.length,checkedAt:new Date().toISOString(),lastSuccess:r.status==='ok'?new Date().toISOString():lastSuccess}),'utf8');
  }
}
