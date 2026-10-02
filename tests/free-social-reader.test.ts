import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rename, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { rootCertificates } from 'node:tls';
import { loadProfiles, collectSocial, fixtureTransport, publicResults, operateSocial } from '../scripts/lib/free-social-reader.ts';

process.env.NODE_ENV = 'test';
process.env.SOCIAL_READER_TEST = '1';
const xId = 'free-x-giswqs', mpId = 'free-mp-gis-frontier';
const body = 'SamGeo tiled inference preserves geospatial coordinates and reconciles overlap before exporting GeoTIFF masks. ';
const post = { id: '197000000000000001', text: body, author: { name: 'Qiusheng Wu', screenName: 'giswqs' }, createdAtISO: new Date().toISOString(), isRetweet: false };
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'rshot-social-reader-'));
  const social = path.join(root, 'social'); await mkdir(social);
  const profiles = path.join(social, 'profiles.json');
  const executable = path.join(root, 'twitter-venv', process.platform === 'win32' ? 'Scripts/twitter.exe' : 'bin/twitter');
  const credentialsFile = path.join(social, 'collectors.env'), wxCreds = path.join(social, 'werss.env');
  const script = path.join(root, 'child.cjs');
  const caDirectory=path.join(root,'.rshot-social-public');await mkdir(caDirectory);await writeFile(path.join(caDirectory,'cacert.pem'),rootCertificates[0]);
  await writeFile(credentialsFile, 'TWITTER_AUTH_TOKEN=fixture-auth-secret\nTWITTER_CT0=fixture-ct0-secret\n');
  await writeFile(wxCreds, 'USERNAME=fixture-user\nPASSWORD=test-password-secret\n');
  const data = { version: 1, twitter: { executable, credentialsFile }, werss: { credentialsFile: wxCreds }, sources: [{ sourceId: xId, verified: true, verifiedAt: new Date().toISOString() }] };
  const save = async () => writeFile(profiles, JSON.stringify(data)); await save();
  return { root, profiles, script, data, save, clean: () => rm(root, { recursive: true, force: true }) };
}
test('default dry run with no profile does not initialize DB or invoke collectors', async () => {
  const f = await fixture();
  try {
    f.data.sources = []; await f.save();
    const out = spawnSync(process.execPath, ['scripts/free-social.ts', '--profiles', f.profiles], { encoding: 'utf8', env: { ...process.env, API_PORT: 'invalid-no-db-guard', MODEL_CALLS_ENABLED: 'false' } });
    assert.equal(out.status, 0, out.stderr); assert.deepEqual(JSON.parse(out.stdout).sources, []);
    const absent = await loadProfiles(path.join(f.root, 'absent.json')); assert.equal(absent.status, 'not-configured');
  } finally { await f.clean(); }
});
test('profile rejects unknown sources, unsafe executable, private URL options and in-repo credentials', async () => {
  const f = await fixture();
  try {
    for (const mutate of [() => { f.data.twitter.executable = process.execPath; }, () => { (f.data as any).werss.baseUrl = 'https://secret.example'; }, () => { f.data.sources[0].sourceId = 'unapproved'; }, () => { f.data.twitter.credentialsFile = path.resolve('package.json'); }]) {
      const original = JSON.stringify(f.data); mutate(); await f.save();
      const p = await loadProfiles(f.profiles); assert.equal(p.status, 'invalid-profile'); assert.ok(!JSON.stringify(p).includes(f.root));
      Object.assign(f.data, JSON.parse(original));
    }
  } finally { await f.clean(); }
});
test('unverified and absent authentication never start a child', async () => {
  const f = await fixture();
  try {
    f.data.sources[0].verified = false; await f.save();
    let p = await loadProfiles(f.profiles); assert.equal((await collectSocial(p))[0].status, 'unverified');
    f.data.sources[0].verified = true; await f.save(); await writeFile(f.data.twitter.credentialsFile, 'TWITTER_AUTH_TOKEN=fixture-auth-secret');
    p = await loadProfiles(f.profiles); assert.equal((await collectSocial(p))[0].status, 'needs-auth');
  } finally { await f.clean(); }
});
test('X uses exact read-only arguments and secret environment; public result omits body', async () => {
  const f = await fixture();
  try {
    await writeFile(f.script, `const a=process.argv.slice(2); if(JSON.stringify(a)!=='["user-posts","giswqs","-n","5","--json"]'||process.env.TWITTER_AUTH_TOKEN!=='fixture-auth-secret'||process.env.TWITTER_CT0!=='fixture-ct0-secret'||process.env.PYTHONUTF8!=='1'||process.env.MODEL_CALLS_ENABLED!=='false'||process.env.COLLECT_ENABLED!=='false'||process.env.INDEXNOW_SUBMIT_ENABLED!=='false')process.exit(7); process.stdout.write(${JSON.stringify(JSON.stringify([post]))});`);
    const result = await collectSocial(await loadProfiles(f.profiles), await fixtureTransport(f.root, { childScript: f.script }));
    assert.equal(result[0].status, 'ok'); assert.equal(result[0].candidates[0].url, 'https://x.com/giswqs/status/197000000000000001');
    const safe = publicResults(result); assert.equal(safe[0].count, 1); assert.ok(!JSON.stringify(safe).includes('bodyText')); assert.ok(!JSON.stringify(safe).includes('fixture-auth-secret'));
  } finally { await f.clean(); }
});
test('child failures, stdout cap and timeout are bounded and discard stderr secrets', async () => {
  const f = await fixture();
  try {
    for (const code of ["process.stderr.write('fixture-auth-secret');process.exit(3)", "process.stdout.write('x'.repeat(2097153))", 'setTimeout(()=>{},5000)', "process.stdout.write('fixture-auth-secret')"]) {
      await writeFile(f.script, code);
      const result = await collectSocial(await loadProfiles(f.profiles), await fixtureTransport(f.root, { childScript: f.script, childTimeoutMs: 100 }));
      assert.equal(result[0].status, 'read-failed'); assert.deepEqual(result[0].candidates, []); assert.ok(!JSON.stringify(result).includes('fixture-auth-secret'));
    }
  } finally { await f.clean(); }
});
test('X unwraps twitter-cli v1 success and rejects failure or unknown wrappers', async () => {
  const f=await fixture();
  try {
    for(const [input,want] of [ [{ok:true,schema_version:'1',data:[post]},'ok'], [{ok:true,schema_version:1,data:[post]},'ok'], [{ok:false,error:{message:'fixture-auth-secret'}},'read-failed'], [{ok:true,schema_version:2,data:[post]},'read-failed'], [{ok:true,schema_version:'2',data:[post]},'read-failed'], [{ok:true,schema_version:1,data:{post}},'read-failed'], [{ok:true,schema_version:1,data:[post],error:{message:'private failure'}},'read-failed'] ] as const) {
      await writeFile(f.script,`process.stdout.write(${JSON.stringify(JSON.stringify(input))})`);
      const result=await collectSocial(await loadProfiles(f.profiles),await fixtureTransport(f.root,{childScript:f.script})); assert.equal(result[0].status,want);assert.ok(!JSON.stringify(result).includes('fixture-auth-secret'));
    }
  } finally {await f.clean();}
});
test('X supplies validated public ASCII CA and only a reachable fixed-scope local proxy', async () => {
  const f=await fixture();const server=createServer((_req,res)=>res.end('fixture proxy unused by controlled child'));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try {
    const port=(server.address() as any).port,ca=path.join(f.root,'.rshot-social-public/cacert.pem');
    await writeFile(f.script,`if(process.env.CURL_CA_BUNDLE!==${JSON.stringify(ca)}||process.env.SSL_CERT_FILE!==${JSON.stringify(ca)}||process.env.TWITTER_PROXY!=='http://127.0.0.1:${port}'||process.env.CURL_SSL_VERIFY==='false')process.exit(7);process.stdout.write(${JSON.stringify(JSON.stringify([post]))});`);
    let r=await collectSocial(await loadProfiles(f.profiles),await fixtureTransport(f.root,{childScript:f.script,proxyPort:port} as any));assert.equal(r[0].status,'ok');
    await writeFile(ca,'not a certificate');r=await collectSocial(await loadProfiles(f.profiles),await fixtureTransport(f.root,{childScript:f.script}));assert.equal(r[0].status,'needs-dependency');
  } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await f.clean();}
});
test('WeRSS authenticates in body and uses only header token with canonical feed path', async () => {
  const f = await fixture(); const requests: any[] = [];
  const xml = `<rss version="2.0"><channel><title>GIS前沿</title><item><title>GeoAI 方法</title><link>https://mp.weixin.qq.com/s/publicArticle_1</link><pubDate>${new Date().toUTCString()}</pubDate><description>${body.repeat(3)}</description></item></channel></rss>`;
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, contentType: req.headers['content-type'], body: raw });
    if (req.url === '/api/v1/wx/auth/login') {
      const form = new URLSearchParams(raw);
      if (req.headers['content-type'] !== 'application/x-www-form-urlencoded' ||
          [...form.keys()].sort().join(',') !== 'password,username' ||
          form.get('username') !== 'fixture-user' || form.get('password') !== 'test-password-secret') {
        res.writeHead(422); res.end('{"detail":"fixture-login-rejected"}'); return;
      }
      res.end(JSON.stringify({ data: { access_token: 'test-access-secret' } }));
    }
    else if (req.url === '/api/v1/wx/mps/update/MP_WXS_123?start_page=0&end_page=1') res.end(JSON.stringify({ code: 0 }));
    else res.end(xml);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try {
    f.data.sources = [{ sourceId: mpId, verified: true, verifiedAt: new Date().toISOString(), feedId: 'MP_WXS_123' } as any]; await f.save();
    const result = await collectSocial(await loadProfiles(f.profiles), await fixtureTransport(f.root, { port: (server.address() as any).port }));
    assert.equal(result[0].status, 'ok'); assert.equal(result[0].candidates[0].url, 'https://mp.weixin.qq.com/s/publicArticle_1');
    assert.deepEqual(requests, [{ method: 'POST', url: '/api/v1/wx/auth/login', auth: undefined, contentType: 'application/x-www-form-urlencoded', body: 'username=fixture-user&password=test-password-secret' }, { method: 'GET', url: '/api/v1/wx/mps/update/MP_WXS_123?start_page=0&end_page=1', auth: 'Bearer test-access-secret', contentType: undefined, body: '' }, { method: 'GET', url: '/rss/MP_WXS_123', auth: 'Bearer test-access-secret', contentType: undefined, body: '' }]);
    assert.ok(!JSON.stringify(result).includes('test-access-secret'));
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await f.clean(); }
});
test('WeRSS rejects redirects, over-limit response and bad identity; failed source is isolated', async () => {
  const f = await fixture(); let mode = 'redirect', hits = 0;
  const server = createServer((req, res) => { hits++; if(req.url?.endsWith('login')) { res.end('{"access_token":"test-access-secret"}'); return; } if(req.url?.includes('/mps/update/')) { res.end('{"code":0}'); return; } if(mode === 'redirect') { res.writeHead(302, { location: '/secret' }); res.end(); } else if(mode==='cap') res.end('x'.repeat(2097153)); else res.end('<rss><channel><title>wrong account</title></channel></rss>'); });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try {
    f.data.sources = [{ sourceId: mpId, verified: true, verifiedAt: new Date().toISOString(), feedId: 'MP_WXS_123' } as any, { sourceId: xId, verified: true, verifiedAt: new Date().toISOString() }]; await f.save();
    await writeFile(f.script, `process.stdout.write(${JSON.stringify(JSON.stringify([post]))})`);
    for (mode of ['redirect','cap','identity']) { const r=await collectSocial(await loadProfiles(f.profiles),await fixtureTransport(f.root,{childScript:f.script,port:(server.address() as any).port})); assert.equal(r[0].status,mode==='identity'?'empty':'read-failed'); assert.equal(r[1].status,'ok'); }
    assert.equal(hits, 9);
    (f.data.sources[0] as any).feedId = 'MP_WXS_123?token=secret'; await f.save(); assert.equal((await loadProfiles(f.profiles)).status,'invalid-profile');
  } finally { server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r())); await f.clean(); }
});

test('WeRSS refresh failure never accepts cached RSS; recent update requires a valid existing feed', async () => {
  const f = await fixture(); let mode = 'server-error'; const requests: string[] = [];
  const xml = `<rss><channel><title>GIS前沿</title><item><title>GeoAI 方法</title><link>https://mp.weixin.qq.com/s/publicArticle_1</link><pubDate>${new Date().toUTCString()}</pubDate><description>${body.repeat(3)}</description></item></channel></rss>`;
  const server = createServer((req, res) => {
    requests.push(req.url!);
    if (req.url === '/api/v1/wx/auth/login') { res.end('{"access_token":"test-access-secret"}'); return; }
    if (req.url?.includes('/mps/update/')) {
      if (mode === 'redirect') { res.writeHead(302, { location: '/secret' }); res.end(); }
      else if (mode === 'cap') res.end('x'.repeat(2097153));
      else res.end(JSON.stringify({ code: mode === 'recent' || mode === 'recent-empty' ? 40402 : mode === 'not-found' ? 40401 : 50002, message: 'fixture-private-error' }));
      return;
    }
    res.end(mode === 'recent-empty' ? '<rss><channel><title>GIS前沿</title></channel></rss>' : xml);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try {
    f.data.sources = [{ sourceId: mpId, verified: true, verifiedAt: new Date().toISOString(), feedId: 'MP_WXS_123' } as any]; await f.save();
    const transport = await fixtureTransport(f.root, { port: (server.address() as any).port });
    for (mode of ['server-error', 'not-found', 'redirect', 'cap']) {
      requests.length = 0;
      const result = await collectSocial(await loadProfiles(f.profiles), transport);
      assert.equal(result[0].status, 'read-failed', mode);
      assert.deepEqual(result[0].candidates, []);
      assert.deepEqual(requests, ['/api/v1/wx/auth/login', '/api/v1/wx/mps/update/MP_WXS_123?start_page=0&end_page=1']);
      assert.ok(!JSON.stringify(result).includes('fixture-private-error'));
    }
    for (mode of ['recent', 'recent-empty']) {
      requests.length = 0;
      const result = await collectSocial(await loadProfiles(f.profiles), transport);
      assert.equal(result[0].status, mode === 'recent' ? 'ok' : 'read-failed');
      assert.deepEqual(requests, ['/api/v1/wx/auth/login', '/api/v1/wx/mps/update/MP_WXS_123?start_page=0&end_page=1', '/rss/MP_WXS_123']);
    }
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await f.clean(); }
});
test('fixture overrides require test context and temporary scope', async () => {
  const f = await fixture();
  try { process.env.SOCIAL_READER_TEST='0'; await assert.rejects(fixtureTransport(f.root, { port: 8041 })); process.env.SOCIAL_READER_TEST='1'; await assert.rejects(fixtureTransport(path.resolve('.'), { port: 1234 })); await assert.rejects(fixtureTransport(f.root, { childScript: path.resolve('package.json') })); }
  finally { process.env.SOCIAL_READER_TEST='1'; await f.clean(); }
});
test('private profile directory junction escape fails before any child or HTTP request', async () => {
  const f = await fixture();
  try {
    const real = path.join(f.root,'linked-social'); await rename(path.join(f.root,'social'),real);
    await symlink(real,path.join(f.root,'social'),process.platform==='win32'?'junction':'dir');
    assert.equal((await loadProfiles(f.profiles)).status,'invalid-profile');
  } finally { await f.clean(); }
});
test('register rejects a read batch mutated after its current sample was normalized', async () => {
  const f=await fixture();
  try {
    await writeFile(f.script,`process.stdout.write(${JSON.stringify(JSON.stringify([post]))})`);
    const p=await loadProfiles(f.profiles),r=await collectSocial(p,await fixtureTransport(f.root,{childScript:f.script}));
    r[0].candidates=[];
    await assert.rejects(operateSocial(p,r,'register'));
  } finally {await f.clean();}
});
test('register refuses unproven samples and verification date absent without initializing DB', async () => {
  const f = await fixture();
  try {
    await writeFile(f.script, `process.stdout.write(${JSON.stringify(JSON.stringify([post]))})`);
    delete (f.data.sources[0] as any).verifiedAt; await f.save();
    const p=await loadProfiles(f.profiles),r=await collectSocial(p,await fixtureTransport(f.root,{childScript:f.script}));
    await assert.rejects(operateSocial(p,[{sourceId:xId,status:'ok',candidates:r[0].candidates}],'register'));
    await operateSocial(p,r,'register'); assert.equal(r[0].operation,'operation-rejected');
  } finally { await f.clean(); }
});
test('PowerShell preparation creates empty external credentials, unverified catalog and preserves existing bytes', {skip:process.platform!=='win32'}, async () => {
  const f = await fixture();
  try {
    const prep=path.resolve('scripts/prepare-social.ps1');
    const caSource=path.join(f.root,'twitter-venv/Lib/site-packages/certifi/cacert.pem');await mkdir(path.dirname(caSource),{recursive:true});await writeFile(caSource,rootCertificates[1]);
    const run=()=>spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',prep,'-PrivateRoot',f.root],{encoding:'utf8',env:{...process.env,USERPROFILE:f.root}});
    // Removing fixture auth makes preparation responsible for creating completely empty files.
    await rm(f.data.twitter.credentialsFile); await rm(f.data.werss.credentialsFile); await rm(f.profiles);
    let r=run(); assert.equal(r.status,0,r.stdout + r.stderr); assert.equal(await readFile(f.data.twitter.credentialsFile,'utf8'),''); assert.equal(await readFile(f.data.werss.credentialsFile,'utf8'),'');
    const p=JSON.parse(await readFile(f.profiles,'utf8')); assert.equal(p.sources.length,12); assert.ok(p.sources.every((s:any)=>s.verified===false));
    assert.equal(await readFile(path.join(f.root,'.rshot-social-public/cacert.pem'),'utf8'),rootCertificates[1]);
    await writeFile(f.data.twitter.credentialsFile,'private-existing-bytes'); r=run(); assert.equal(r.status,0,r.stdout+r.stderr); assert.equal(await readFile(f.data.twitter.credentialsFile,'utf8'),'private-existing-bytes'); assert.ok(!r.stdout.includes(f.root));
    const acl=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$a=[IO.File]::GetAccessControl('${f.data.twitter.credentialsFile.replaceAll("'","''")}'); @($a.Access | ForEach-Object {$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value}) | ConvertTo-Json -Compress`],{encoding:'utf8'});
    assert.equal(acl.status,0,acl.stderr); const principals=JSON.parse(acl.stdout); assert.equal(principals.length,2); assert.ok(principals.includes('S-1-5-18'));
    const rejected=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',prep,'-PrivateRoot',path.resolve('.data/unsafe-social-prep')],{encoding:'utf8'}); assert.equal(rejected.status,1);
  } finally { await f.clean(); }
});
test('PowerShell wrapper preserves native exit and logs only safe stream metadata', {skip:process.platform!=='win32'}, async () => {
  const f=await fixture();
  try {
    const scripts=path.join(f.root,'scripts'); await mkdir(scripts);
    await copyFile('scripts/run-social-task.ps1',path.join(scripts,'run-social-task.ps1'));
    await writeFile(path.join(scripts,'free-social.ts'),`if(['MODEL_CALLS_ENABLED','COLLECT_ENABLED','FEISHU_CONTENT_PUSH_ENABLED','INDEXNOW_SUBMIT_ENABLED'].some(k=>process.env[k]!=='false'))process.exit(8); console.log('fixture-secret-stdout');console.error('fixture-secret-stderr');process.exit(3);`);
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',path.join(scripts,'run-social-task.ps1')],{encoding:'utf8'});
    assert.equal(result.status,3,result.stderr); const log=await readFile(path.join(f.root,'.data/logs/social-collection.log'),'utf8');
    assert.ok(!log.includes('fixture-secret-stdout')); assert.ok(!log.includes('fixture-secret-stderr'));
    const metadata=JSON.parse(log.replace(/^\uFEFF/,''));
    assert.deepEqual(Object.keys(metadata).sort(),['exitCode','status','stderrBytes','stdoutBytes']);
    assert.equal(metadata.status,'failed'); assert.equal(metadata.exitCode,3);
    assert.ok(metadata.stdoutBytes>0); assert.ok(metadata.stderrBytes>0);
  } finally { await f.clean(); }
});
test('installer rejects no verified source before accessing Task Scheduler', {skip:process.platform!=='win32'}, async () => {
  const f=await fixture();
  try { f.data.sources=[];await f.save(); const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',path.resolve('scripts/install-social-task.ps1'),'-Profiles',f.profiles],{encoding:'utf8'}); assert.equal(result.status,1,result.stderr); assert.ok(result.stdout.includes('social-task-install-rejected')); assert.ok(!result.stdout.includes(f.root)); }
  finally {await f.clean();}
});
test('installer emits twice-daily current-user action, is idempotent and refuses mismatched owners', {skip:process.platform!=='win32'}, async () => {
  const f=await fixture();
  try {
    await mkdir(path.dirname(f.data.twitter.executable),{recursive:true}); await writeFile(f.data.twitter.executable,'fixture dependency only; never executed');
    const taskFile=path.join(f.root,'scheduler.json'), counter=path.join(f.root,'register-count.json'), harness=path.join(f.root,'scheduler.ps1');
    const quote=(s:string)=>s.replaceAll("'","''");
    // Replace only the OS write boundary; the installer, native Node readiness and profile validation run unchanged.
    await writeFile(harness,`\uFEFFfunction Get-ScheduledTask { param($TaskName) if(Test-Path -LiteralPath '${quote(taskFile)}'){Get-Content -LiteralPath '${quote(taskFile)}' -Encoding UTF8 -Raw|ConvertFrom-Json} }
function New-ScheduledTaskAction {param($Execute,$Argument,$WorkingDirectory) @{Execute=$Execute;Arguments=$Argument;WorkingDirectory=$WorkingDirectory}}
function New-ScheduledTaskTrigger {param([switch]$Daily,$At) @{StartBoundary=('2026-10-02T'+$At+':00');DaysInterval=1}}
function New-ScheduledTaskSettingsSet {param([switch]$Hidden,[switch]$StartWhenAvailable,$ExecutionTimeLimit,$MultipleInstances) @{Hidden=[bool]$Hidden;MultipleInstances=$MultipleInstances}}
function New-ScheduledTaskPrincipal {param($UserId,$LogonType,$RunLevel) @{UserId=$UserId;LogonType=$LogonType;RunLevel=$RunLevel}}
function Register-ScheduledTask {param($TaskName,$Action,$Trigger,$Settings,$Principal,$Description) @{TaskName=$TaskName;Actions=@($Action);Triggers=$Trigger;Settings=$Settings;Principal=$Principal}|ConvertTo-Json -Depth 10|Set-Content -Encoding UTF8 -LiteralPath '${quote(taskFile)}'; '1'|Set-Content -LiteralPath '${quote(counter)}'}
& '${quote(path.resolve('scripts/install-social-task.ps1'))}' -Apply -Profiles '${quote(f.profiles)}'
exit $LASTEXITCODE
`);
    const run=()=>spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',harness],{encoding:'utf8',env:{...process.env,USERPROFILE:f.root}});
    let r=run();assert.equal(r.status,0,r.stdout+r.stderr); const task=JSON.parse((await readFile(taskFile,'utf8')).replace(/^\uFEFF/,'')); assert.equal(task.TaskName,'RSHOT-Collect-Social'); assert.deepEqual(task.Triggers.map((t:any)=>t.StartBoundary.slice(11,16)),['06:30','18:30']);assert.equal(task.Principal.LogonType,'Interactive');assert.equal(task.Principal.RunLevel,'Limited');assert.equal(task.Settings.Hidden,true);assert.ok(task.Actions[0].Arguments.includes('-WindowStyle Hidden'));assert.ok(!JSON.stringify(task).includes('fixture-auth-secret'));
    await writeFile(counter,'unchanged');r=run();assert.equal(r.status,0,r.stdout+r.stderr);assert.ok(r.stdout.includes('already-installed'));assert.equal(await readFile(counter,'utf8'),'unchanged');
    task.Triggers[0].DaysInterval=2;await writeFile(taskFile,JSON.stringify(task));r=run();assert.equal(r.status,1);assert.equal(await readFile(counter,'utf8'),'unchanged');task.Triggers[0].DaysInterval=1;
    task.Principal.UserId='fixture-other-user';await writeFile(taskFile,JSON.stringify(task));r=run();assert.equal(r.status,1);assert.equal(await readFile(counter,'utf8'),'unchanged');
  } finally {await f.clean();}
});
test('real test DB register preserves disabled/tight policy and manual rows; apply uses controlled admission', {skip:process.env.FREE_SOCIAL_READER_DB_TEST!=='true'}, async () => {
  const url=new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname,'127.0.0.1'); assert.equal(url.port,'18878'); assert.equal(url.pathname,'/rshot_social_test'); assert.equal(url.username,'postgres'); assert.equal(url.password,'local-social-test-only'); assert.match(url.pathname,/_test$/);
  Object.assign(process.env,{COLLECT_ENABLED:'false',MODEL_CALLS_ENABLED:'false',FEISHU_CONTENT_PUSH_ENABLED:'false',INDEXNOW_SUBMIT_ENABLED:'false'});
  const {sql,closeDb}=await import('../packages/backend/src/db.ts');
  const f=await fixture();
  const [oldPolicy]=await sql`SELECT value,updated_by FROM settings WHERE key='collection.policy'`;
  const collision=await sql`SELECT id FROM sources WHERE id=${xId}`; assert.equal(collision.length,0,'test needs an unused approved source');
  const tight={enabled:true,since:new Date(Date.now()-3600000).toISOString(),maxAgeHours:1,perRun:1,perHour:1,perDay:1,perSourceDay:1,sourceIds:['fixture-existing-source']};
  let articleId: string|undefined;
  try {
    await writeFile(f.script,`process.stdout.write(${JSON.stringify(JSON.stringify([post]))})`);
    const p=await loadProfiles(f.profiles),transport=await fixtureTransport(f.root,{childScript:f.script});
    const sample=()=>collectSocial(p,transport);
    const policy=async (value:typeof tight)=>sql`INSERT INTO settings(key,value,updated_by) VALUES('collection.policy',${sql.json(value)},'social-test') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
    await sql`DELETE FROM settings WHERE key='collection.policy'`; let r=await sample(); await operateSocial(p,r,'register'); assert.equal(r[0].operation,'operation-rejected'); assert.equal((await sql`SELECT id FROM sources WHERE id=${xId}`).length,0);
    await policy({...tight,enabled:false}); r=await sample(); await operateSocial(p,r,'register'); assert.equal(r[0].operation,'operation-rejected'); assert.equal((await sql`SELECT id FROM sources WHERE id=${xId}`).length,0);
    await policy(tight);
    await sql`INSERT INTO sources(id,name,kind,config,tier,participation_mode,enabled,next_fetch_at) VALUES(${xId},'Manual source','external',${sql.json({manual:true})},'T2','editorial',true,'2100-01-01')`;
    r=await sample(); await operateSocial(p,r,'register'); assert.equal(r[0].operation,'operation-rejected'); const [manual]=await sql`SELECT name,config FROM sources WHERE id=${xId}`; assert.equal(manual.name,'Manual source'); assert.deepEqual(manual.config,{manual:true});
    await sql`DELETE FROM sources WHERE id=${xId}`;
    await sql`INSERT INTO sources(id,name,kind,config,tier,participation_mode,enabled,site_fulltext,syndicate_fulltext,next_fetch_at) VALUES(${xId},'Qiusheng Wu · giswqs','external',${sql.json({})},'T1_5','editorial',true,false,false,'2100-01-01')`;
    for (const flags of [{ site: true, syndicate: false }, { site: false, syndicate: true }]) {
      await sql`UPDATE sources SET site_fulltext=${flags.site},syndicate_fulltext=${flags.syndicate} WHERE id=${xId}`;
      r=await sample(); await operateSocial(p,r,'register'); assert.equal(r[0].operation,'operation-rejected');
      const [preserved]=await sql`SELECT name,site_fulltext,syndicate_fulltext FROM sources WHERE id=${xId}`;
      assert.deepEqual(preserved,{name:'Qiusheng Wu · giswqs',site_fulltext:flags.site,syndicate_fulltext:flags.syndicate});
      const [unchanged]=await sql`SELECT value FROM settings WHERE key='collection.policy'`;
      assert.deepEqual(unchanged.value,tight);
    }
    await sql`DELETE FROM sources WHERE id=${xId}`;
    r=await sample(); await operateSocial(p,r,'register'); assert.equal(r[0].operation,'registered');
    const [registered]=await sql`SELECT kind,config,tier,participation_mode,enabled,site_fulltext,syndicate_fulltext FROM sources WHERE id=${xId}`;
    assert.deepEqual(registered,{kind:'external',config:{},tier:'T1_5',participation_mode:'editorial',enabled:true,site_fulltext:false,syndicate_fulltext:false});
    const [updated]=await sql`SELECT value FROM settings WHERE key='collection.policy'`; assert.deepEqual(updated.value,{...tight,sourceIds:['fixture-existing-source','free-x-giswqs']});
    r=await sample(); await operateSocial(p,r,'register'); assert.equal(r[0].operation,'registered');
    await operateSocial(p,r,'apply'); assert.equal(r[0].operation,'applied');
    const [article]=await sql`SELECT id,url,source_id FROM articles WHERE source_id=${xId}`; articleId=article?.id; assert.equal(article.url,'https://x.com/giswqs/status/197000000000000001');
    const [queued]=await sql`SELECT count(*)::int n FROM collection_admissions WHERE source_id=${xId}`; assert.equal(queued.n,1);
    await policy({...tight,enabled:false,sourceIds:[xId]}); r=await sample(); await operateSocial(p,r,'apply'); assert.equal(r[0].operation,'operation-rejected');
  } finally {
    await sql`DELETE FROM pgboss.job WHERE data->>'articleId' IN (SELECT id FROM articles WHERE source_id=${xId})`;
    await sql`DELETE FROM collection_observations WHERE source_id=${xId}`;
    await sql`DELETE FROM collection_admissions WHERE source_id=${xId}`;
    if(articleId) await sql`DELETE FROM articles WHERE id=${articleId}`;
    await sql`DELETE FROM sources WHERE id=${xId}`;
    if(oldPolicy) await sql`UPDATE settings SET value=${sql.json(oldPolicy.value)},updated_by=${oldPolicy.updated_by} WHERE key='collection.policy'`; else await sql`DELETE FROM settings WHERE key='collection.policy'`;
    await f.clean();const {stopBoss}=await import('../packages/backend/src/jobs/queue.ts');await stopBoss();await closeDb();
  }
});
