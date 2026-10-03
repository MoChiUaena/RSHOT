# RSHOT upstream stage 2 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax. Production integration follows the controller verification and backup gates; user authorization for the staged upgrade is already recorded in the spec.

**Goal:** Adapt the four approved stage-2 safety clusters—receipt/processing recovery, report coverage/recovery, public scope/manual corrections, and session binding—without replacing RSHOT behavior or private data.

**Architecture:** Add shared audit/shutdown/transaction primitives first, then graft the required fixed-upstream behavior into existing modules. Keep compatibility exports while each cluster is built and tested. Preserve current grouping algorithms, industry content, Pages whitelist and private wrappers; upstream module splits and reader features remain later-stage work.

**Tech stack:** Node.js >=24.11 TypeScript, PostgreSQL 17 isolated test databases, postgres 3.4.9, pg-boss 12.34.0, node:test, local HTTP mock providers; existing npm workspaces. Stage 2 adds no package dependency.

**Spec:** `docs/superpowers/specs/2026-10-03-rshot-upstream-upgrade.md`; The controller mapping is retained privately in the stage-1 ledger; the requirements below are self-contained. Fixed upstream `3343fe2`; RSHOT original baseline `dfba98f`; execution starts from the controller's reviewed stage-1 tip, not a reset to baseline.

## Global constraints

- Independent `codex/rshot-upstream-upgrade` worktree; each approved batch gets a separate reviewed commit. This draft changes only the ignored plan artifact; no staging, branch, commit or production edit is performed while writing it.
- Preserve RSHOT brand, six categories, topics, sources, prompts, calibrated thresholds, editorial bundles and manual USGS/West Africa correction. Use synthetic fixtures, never private labels/authorization files.
- Preserve admission limits, original identity/date checks, free social adapters and wrappers, local model configuration and secret protection. Keep WeRead retired and leaderboard/Codex reset modules off.
- Preserve anonymous publication-only website/API/RSS/MCP and Pages snapshot schemaVersion=1 field whitelist. Reader actions never call models.
- Windows publication/X tasks remain daily Beijing 10:30; October-7 review stop and current accounts/tasks/credentials are untouched. Retain worker stop-request/startup scheduling/heartbeat cleanup and Docker 4-minute stop grace.
- New migrations append after existing `0040_collection_admission.sql`; keep `0039_calibration_labels.sql`, `0040_collection_admission.sql` and their migration records unchanged.
- No real DB/API/model/source access. Tests use the established internal QA network and disposable `_test`/`_ci` databases. A test-only model flag may be true solely in local-stub test processes; no real model evaluation or paid service enabling.
- Paid requests still reserve through receipts and existing budgets. Source quotas and controlled RSS retryability remain effective.

## Existing evidence and harness

Controller evidence: Linux baseline source `65fa905`, 206 pass / 7 platform or optional skips; Windows preservation 51 pass / 2 optional DB skips. Linux container `rshot-upgrade-qa` has `/workspace` volume and read-only worktree bind `/input`; PostgreSQL fixture container is `rshot-upgrade-test-db`, DNS alias `db:5432`, Windows loopback mapping 18881. QA has no default route on internal `rshot-upgrade-offline-net`; dependencies were installed before isolation. These are baseline results, not stage-2 validation.

### Source synchronization and test commands

Do not overwrite QA node_modules or its test-only Git metadata and do not copy `.env`, `.data`, auth files or arbitrary untracked files. For RED, copy reviewed stage-1 tracked files plus explicit approved regression paths; for GREEN, include each new source/migration path listed below. The controller should maintain this exact manifest as task files are created:

```powershell
# Run from the upgrade worktree; writes ignored manifest only.
@'
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
const tracked = execFileSync('git', ['ls-files', '-z', '--', 'packages', 'apps', 'database', 'scripts', 'tests', 'industry', 'package.json', 'package-lock.json', 'tsconfig.base.json'], {encoding:'utf8'}).split('\0').filter(Boolean);
const added = [
 'packages/backend/src/audit.ts', 'packages/backend/src/lib/shutdown.ts',
 'packages/backend/src/operations/recover.ts', 'packages/backend/src/events/corrections.ts',
 'packages/backend/src/events/derived-content.ts', 'packages/backend/src/publication/scope.ts',
 'packages/backend/src/publication/hot.ts',
 'database/migrations/0041_oss_recovery.sql', 'database/migrations/0042_oss_domain_recovery.sql',
 'database/migrations/0043_admin_session_binding.sql',
 'tests/core-recovery-fixture.ts', 'tests/events-oss-withdrawal-fixture.ts',
 ...['core-receipt-state','core-receipt-shutdown','core-queue-recovery','core-processing-recovery',
 'core-extraction-consistency','core-embedding-dimensions','core-admin-corrections','core-source-promotion',
 'report-candidates','reports-oss-due','reports-oss-recovery','events-oss-withdrawal','events-oss-digest-race',
 'hot-cover-scope','timeline-release','topic-release','topic-detail-counts','admin-session-migration',
 'admin-session-revocation','rshot-core-preservation','rshot-report-catchup'].map(n=>`tests/${n}.test.ts`)
];
const files = [...new Set([...tracked,...added])].filter(existsSync);
if (files.some(f=>/(^|\/)(\.env|\.data|node_modules)(\/|$)/.test(f))) throw Error('Unsafe manifest');
writeFileSync('.superpowers/sdd/2026-10-03-rshot-upstream-stage1/core-sync-files.json', JSON.stringify(files));
'@ | node --input-type=module
docker exec rshot-upgrade-qa node --input-type=module -e 'import {readFileSync,mkdirSync,copyFileSync} from "node:fs"; import path from "node:path"; const files=JSON.parse(readFileSync("/input/.superpowers/sdd/2026-10-03-rshot-upstream-stage1/core-sync-files.json","utf8")); for(const file of files){if(path.isAbsolute(file)||file.split(/[\\/]/).includes(".."))throw Error("Unsafe path");const dest=path.join("/workspace",file);mkdirSync(path.dirname(dest),{recursive:true});copyFileSync(path.join("/input",file),dest);}'
```

Create only a QA fixture role/databases when executing, using an explicitly synthetic password. No installed credential is read. Run create once; use a new phase DB name for every RED and GREEN run (the names shown are not reused):

```powershell
# Controller prepares the disposable owner and supplies its private connection base.
# RSHOT_QA_DATABASE_BASE is provided in an ignored local harness, never in committed docs.
if (-not $env:RSHOT_QA_DATABASE_BASE) { throw 'Missing private test connection base' }
function New-CoreQaDb([string]$DbName) {
  if ($DbName -notmatch '^rshot_upgrade_core_[a-z0-9_]+_test$') { throw 'Unexpected fixture DB name' }
  docker exec rshot-upgrade-test-db createdb -U postgres -O rshot_stage2_qa $DbName
  if ($LASTEXITCODE) { throw 'Fixture DB create failed; choose a new suffix, never drop another database' }
  docker exec -w /workspace -e "DATABASE_URL=$($env:RSHOT_QA_DATABASE_BASE)/$DbName" -e AIHOT_CREDENTIALS_DIR=/nonexistent-test-credentials -e RSHOT_MODEL_FILE=/nonexistent-rshot-model.env -e MODEL_CALLS_ENABLED=false -e COLLECT_ENABLED=false -e FEISHU_CONTENT_PUSH_ENABLED=false -e FEISHU_INTERNAL_ENABLED=false -e INDEXNOW_SUBMIT_ENABLED=false rshot-upgrade-qa node scripts/migrate.ts
  if ($LASTEXITCODE) { throw 'Fixture migration failed' }
  docker exec -w /workspace -e "DATABASE_URL=$($env:RSHOT_QA_DATABASE_BASE)/$DbName" -e AIHOT_CREDENTIALS_DIR=/nonexistent-test-credentials -e RSHOT_MODEL_FILE=/nonexistent-rshot-model.env -e MODEL_CALLS_ENABLED=false -e COLLECT_ENABLED=false -e FEISHU_CONTENT_PUSH_ENABLED=false -e FEISHU_INTERNAL_ENABLED=false -e INDEXNOW_SUBMIT_ENABLED=false rshot-upgrade-qa node scripts/seed.ts
  if ($LASTEXITCODE) { throw 'Fixture seed failed' }
}
function Test-CoreQa([string]$DbName,[string[]]$TestFiles) {
  if ($DbName -notmatch '^rshot_upgrade_core_[a-z0-9_]+_test$') { throw 'Unexpected fixture DB name' }
  docker exec -w /workspace -e "DATABASE_URL=$($env:RSHOT_QA_DATABASE_BASE)/$DbName" -e AIHOT_CREDENTIALS_DIR=/nonexistent-test-credentials -e RSHOT_MODEL_FILE=/nonexistent-rshot-model.env -e MODEL_CALLS_ENABLED=true -e COLLECT_ENABLED=false -e FEISHU_CONTENT_PUSH_ENABLED=false -e FEISHU_INTERNAL_ENABLED=false -e INDEXNOW_SUBMIT_ENABLED=false -e FREE_SOCIAL_DB_TEST=false -e FREE_SOCIAL_READER_DB_TEST=false rshot-upgrade-qa node --test --test-concurrency=1 --test-timeout=120000 @TestFiles
}
```

Before every model-bearing suite verify isolation with `docker exec rshot-upgrade-qa node -e 'const t=require("node:fs").readFileSync("/proc/net/route","utf8");if(t.split("\n").slice(1).some(l=>l.trim().split(/\s+/)[1]==="00000000"))throw Error("QA must have no default route");'`. Stub tests set base URL and fake API key before importing backend modules; never pass a real key. Migration/seed/typecheck/build processes use model flag false. The QA image currently has no psql/createdb client, hence DB creation runs in the dedicated PostgreSQL container.

Upstream test import must preserve UTF-8: use Node `execFileSync('git',['show','3343fe2:tests/<named-file>'])` and write its Buffer to the listed test path. Avoid PowerShell text redirection/encoding conversion. Keep original invariant assertions and adapt only known imports, taxonomy and migration filenames. RED means assertion/transaction failure, not missing module, invalid taxonomy, absent fixture DB or network failure.

## Task 1: Foundation—one audit, one shutdown, guarded receipts and queue startup

**Files:** Create `packages/backend/src/audit.ts`, `packages/backend/src/lib/shutdown.ts`. Modify `providers/receipts.ts`, `jobs/queue.ts`, `admin/auth.ts`, `admin/sources.ts` under backend src. Add `tests/{core-receipt-state,core-receipt-shutdown,core-queue-recovery}.test.ts`. Keep `db.ts`, package files and all service settings unchanged.

**Interfaces:**

```ts
// audit.ts; string overload keeps existing seventh-argument requestId callers buildable.
export class Conflict extends Error { code = 'conflict'; }
export async function audit(actor: string, action: string, subject: string|null,
  reason: string|null, before: unknown, after: unknown,
  opts: string | {requestId?: string; db?: Db} = {}): Promise<void>;
// lib/shutdown.ts
export const shutdownSignal = new AbortController();
// receipts.ts, sole receipt writer
export async function releaseUnknownReceipt(db: Db, id: number, error: string):
  Promise<{subject: string|null; purpose: string}|null>;
// queue.ts retains enqueue(name:string,data:object,options:SendOptions={},tx?:Db)
export async function retryReleasedReceiptJobs(): Promise<number>;
```

- [ ] Import the three upstream tests. They use existing baseline APIs; no adapter is needed. Run RED on `rshot_upgrade_core_foundation_red_test`:

```powershell
New-CoreQaDb rshot_upgrade_core_foundation_red_test
Test-CoreQa rshot_upgrade_core_foundation_red_test @('tests/core-receipt-state.test.ts','tests/core-receipt-shutdown.test.ts','tests/core-queue-recovery.test.ts')
```

Expected: recovery must not overwrite a concurrently committed received answer; new paid reservation after shutdown must fail before budget write; a failed initial queue connection must not poison later calls. Record the actual failing assertions.

- [ ] Extract audit without importing the upstream Admin contract refactor. Normalize `typeof opts === 'string' ? {requestId:opts} : opts`; use `opts.db ?? sql` for INSERT and JSON serialization. `admin/auth.ts` imports/re-exports the same audit function; remove its local implementation. `admin/sources.ts` imports/re-exports the same Conflict class; remove its local definition. Existing consumers continue compiling; no new duplicate Conflict.
- [ ] Move AbortController to lib/shutdown and re-export from jobs/queue. In paidRequest return received/completed reuse before `shutdownSignal.signal.throwIfAborted()`. In stale receipt sweep perform status/age-qualified UPDATE and associated pending attempts UPDATE in one transaction. Add releaseUnknownReceipt (unknown -> failed and unknown attempts -> failed in supplied tx). Keep logicalKeyFor, service budget lock and budget accounting byte-compatible.
- [ ] Reset getBoss startup promise in finally; cleanup failed start without replacing the primary error. Add failed-job recovery query with release audit timestamp > job.started_on and output receiptId match, SKIP LOCKED and LIMIT 200. Keep original payload and STOP_TIMEOUT_MS=195000. Retain current generic enqueue and boss.work handlers; typed JobData/work refactor is deferred and not required for transaction recovery.
- [ ] Synchronize GREEN source; create `rshot_upgrade_core_foundation_green_test`; run the same three tests plus `tests/receipts.test.ts` and `tests/signals.test.ts` with Test-CoreQa. Run `npm run typecheck` with model/collection/push valves false on Windows. Require all selected tests and typecheck passing; no optional test expansion after the concrete risks are covered.

```powershell
New-CoreQaDb rshot_upgrade_core_foundation_green_test
Test-CoreQa rshot_upgrade_core_foundation_green_test @('tests/core-receipt-state.test.ts','tests/core-receipt-shutdown.test.ts','tests/core-queue-recovery.test.ts','tests/receipts.test.ts','tests/signals.test.ts')
```
- [ ] Record a controller review checkpoint before proceeding; the implementer stages/commits only the owned task files; the controller performs the independent review before the next task.

## Task 2: Durable processing identity and atomic recovery

**Files:** Create `database/migrations/0041_oss_recovery.sql`, backend `operations/recover.ts`. Modify `jobs/content.ts`, `content/{extract,materials}.ts`, `providers/{llm,embeddings}.ts`, `admin/{content,runs}.ts`, `apps/worker/src/schedules.ts`. Graft compatibleEmbedding checks into existing `events/group.ts` vector cache/warmRecallWindow, without moving recall functions. Tests: upstream core-processing-recovery/core-extraction-consistency/core-embedding-dimensions plus `tests/core-recovery-fixture.ts` and preservation tests below.

**Interfaces:** queueProcessing retains `{step?:'extract'|'analyze',attemptTag?:string,db?:Db}`; processArticle retains `(articleId,opts?:{attemptTag?:string}) -> {state:string}`. Add `resumeAfterRelease(receipt:{purpose:string;subject:string|null},db:Db):Promise<boolean>`, `resumeSourceArticles(sourceId:string,db:Db):Promise<void>`, `recoverStaleWork()`, `releaseReceipt(id,input:{billed:boolean;note:string},actor)`, `autoReleaseUnknownReceipts(now?:number)`. ModelOutputError gains `receiptId:number|null` with default null; preserve all existing completionParameters and chatJson request identity branches.

- [ ] Port tests and fix synthetic category `ai-models` -> `rs-tools`; keep seven valid ITEM_TYPES and current selection thresholds. Match RSHOT prefilter mock system by the existing prompt's actual text, not upstream AI-only phrases. Change core-embedding-dimensions dynamic warmRecallWindow import from `events/recall` to existing `events/group`; keep all finite/dimension/atomic batch assertions.
- [ ] To obtain valid RED on baseline existing APIs, core-processing-recovery imports recoverStaleWork/releaseReceipt from test adapter, whose RED implementation is:

```ts
// tests/core-recovery-fixture.ts, used only until operations/recover exists
import { autoReleaseUnknownReceipts } from '@aihot/backend/admin/runs';
import { markStalePendingReceipts } from '@aihot/backend/providers/receipts';
import { markStaleDeliveries } from '@aihot/backend/notify/deliver';
export { releaseReceipt } from '@aihot/backend/admin/runs';
export async function recoverStaleWork() {
  return {receipts: await markStalePendingReceipts(),
    released: await autoReleaseUnknownReceipts(), deliveries: await markStaleDeliveries()};
}
```

Prepare the new column as test-only RED fixture schema without changing baseline production code, so lost identity fails behavior assertions instead of a missing-column error:

```powershell
New-CoreQaDb rshot_upgrade_core_processing_red_test
docker exec rshot-upgrade-test-db psql -U postgres -d rshot_upgrade_core_processing_red_test -v ON_ERROR_STOP=1 -c 'ALTER TABLE articles ADD COLUMN processing_attempt_tag text;'
Test-CoreQa rshot_upgrade_core_processing_red_test @('tests/core-processing-recovery.test.ts','tests/core-extraction-consistency.test.ts','tests/core-embedding-dimensions.test.ts')
```

The tag-column existence itself is a migration assertion, not a behavior RED; record queue/receipt identity and transaction failures as RED evidence.
- [ ] Append upstream 0039 SQL under exact new name **0041_oss_recovery.sql**. Do not change installed 0039/0040. Persist attemptTag through queueProcessing, extraction/sweep/release and reread it during manual recovery. processRevision includes RSHOT settled curated guard and revision-qualified completion/failure/reset. Receipts of CAPABILITIES purposes and body_fallback/x_article resume failed articles; unknown release, reset, queue and audit commit together.
- [ ] Rerun takes article lock; query durable audit by actor/action/subject/requestId; repeated command returns earlier jobId. Reset + enqueue(tx) + audit(tx) are atomic. Move release logic to operations/recover and leave `admin/runs.ts` re-exports of releaseReceipt/autoReleaseUnknownReceipts. Change worker ops.recover run only; preserve worker main.ts lifecycle controls. Leave delivery resolve where it is for this stage: notification resend/card refactor is a separate dependency, not needed by recoverStaleWork's existing markStaleDeliveries.
- [ ] Graft extraction revision guards, same-content revision dedup and X Article block replacement. Keep current markdownToHtml and free reader behavior. Source material revision resets retry state; preserve raw material scope hash and historical dating. Embed responses validate entire finite/index/dimension batch before writes; save embeddings and completeReceipt in one tx. Existing group vectorsFor/warmRecallWindow must check current model and compatible dimensions so the imported dimension tests do not require recall.ts.
- [ ] RSHOT preservation tests remain mandatory: `curation.test.ts` already proves stale automatic processArticle sends no model work, later evidence can reopen processing, histories retain dates and manual override survives. Add to `rshot-core-preservation.test.ts` a synthetic manual attempt that fails once, is recovered and reuses same logical paid identity while the settled curated automatic job still reports analyzed. Also run `model-request.test.ts`, `score-source.test.ts`, `collection-admission.test.ts`, `collection-setup.test.ts`, `bounded-batch.test.ts`, `free-social.test.ts`: unchanged provenance host excludes credentials/query/tier, materialScope expires only after body change, completion parameter and legacy receipt identities stay intact, concurrent source quotas and limited RSS ETag behavior hold.
- [ ] Switch adapter to `export {recoverStaleWork,releaseReceipt} from '@aihot/backend/operations/recover';`, synchronize, create `rshot_upgrade_core_processing_green_test`, run above core+preservation files serially and typecheck. Model mocks are loopback only. No real source is fetched. Review checkpoint.

```powershell
New-CoreQaDb rshot_upgrade_core_processing_green_test
Test-CoreQa rshot_upgrade_core_processing_green_test @('tests/core-processing-recovery.test.ts','tests/core-extraction-consistency.test.ts','tests/core-embedding-dimensions.test.ts','tests/rshot-core-preservation.test.ts','tests/curation.test.ts','tests/model-request.test.ts','tests/score-source.test.ts','tests/collection-admission.test.ts','tests/collection-setup.test.ts','tests/bounded-batch.test.ts','tests/free-social.test.ts')
```

## Task 3: Cross-period reports, atomic publication and bounded catch-up

**Files:** Modify backend `reports/compose.ts`, `publication/publish.ts`, `editorial/curation.ts`; change only report due imports/callbacks in `apps/worker/src/schedules.ts`. Add upstream `tests/{report-candidates,reports-oss-due,reports-oss-recovery}.test.ts`; extend `tests/report-preservation.test.ts`; add `tests/rshot-report-catchup.test.ts`. `publication/reports.ts` keeps editorialMode; no issueNumber/media/Agent dependency is required.

**Interfaces:** preserve `composeDaily(date,reason='scheduled',options:{preview?:boolean}={}) -> Promise<{key:string;entries:number;content?:Record<string,unknown>}>`, composeWeekly/Monthly and candidates. Add dueDaily/Weekly/Monthly `(now?:Date):string`. Change catchUpReports second argument to attempt limit, default 8, and additive return `{generated:string[];failed:string[]}` (failure still throws an error naming failed keys). Current sole scheduler uses default argument. Persist private progress in settings key `reports.catch-up.cursor`, shape `{last:{daily:string|null,weekly:string|null,monthly:string|null},nextKind:'daily'|'weekly'|'monthly'}`; no extra table/model/provider.

- [ ] Import report-candidates and reports-oss-recovery before changing production; these existing function imports yield real RED. Test due functions later with a dynamic module existence assertion first (`assert.equal(typeof reports.dueDaily,'function')`) so absent APIs are explicitly recorded separately. Add exact synthetic no-metrics preservation assertions:

```ts
const before = (await sql`SELECT content,origin,revision FROM reports WHERE kind='daily' AND key=${key}`)[0];
assert.equal((await composeDaily(key,'scheduled')).entries,1);
assert.deepEqual((await sql`SELECT content,origin,revision FROM reports WHERE kind='daily' AND key=${key}`)[0],before);
const preview = await composeDaily(key,'preview',{preview:true});
assert.equal((preview.content!.generator as {preview:boolean}).preview,true);
assert.deepEqual((await sql`SELECT content,origin,revision FROM reports WHERE kind='daily' AND key=${key}`)[0],before);
```

Use current report-preservation fixture, synthetic key and local mock only when needed; no real report edited. Run RED on `rshot_upgrade_core_reports_red_test`, selected files report-candidates/reports-oss-recovery/report-preservation.

```powershell
New-CoreQaDb rshot_upgrade_core_reports_red_test
Test-CoreQa rshot_upgrade_core_reports_red_test @('tests/report-candidates.test.ts','tests/reports-oss-recovery.test.ts','tests/report-preservation.test.ts')
```
- [ ] In publishArticleTx: article lock, shared report_candidates advisory lock, then sample now; early grouping release and selected_ledger use same sampled release time. candidates: exclusive lock and READ COMMITTED SELECT; select selected/public/nonbackfill by max(timeline_at,visible_after) in [start,end). Keep firstParty role text 一手 and fact representative logic.
- [ ] Report save: acquire report:<kind>:<key> advisory lock before row read; automatic existing issue completes any reused received receipt but preserves content/origin/revision; explicit correction compares starting revision; report_revisions + reports + receipt completion commit together. saveManualReport in curation takes identical commit lock and keeps curated-edition ownership rule. savedReport counts actual section items/theme references when metrics/storyOrder absent.
- [ ] Preserve preview path: truncate end at now, return content with generator.preview, use daily-preview receipt subject, never insert/update reports or revisions. Preserve future automatic guard. Empty published issue fails before model call; periodic model output with no valid refs is rejected and remains unpublished. Keep editorialMode in publication/report contract and strict Pages mapper.
- [ ] Add due functions as fixed upstream. Catch-up computes missing issues since first existing issue of each kind (or latest due if none); rotates starting kind and per-kind missing-key position using durable cursor. Every compose call, including failure, increments attempts; stop at limit attempts (eight by default), persist last attempted key/next kind after each attempt, wrap to older keys only after reaching due key. Successful issues append generated, failed append failed, remaining types/keys progress on next run; shutdown stops without a new call. This preserves failure visibility and prevents a fixed set of empty early daily gaps from consuming every later run. Keep service budget unchanged; do not create empty placeholder reports.
- [ ] Add rshot-report-catchup fixtures: >8 empty daily gaps plus one due weekly and one monthly with local selected entries; invoke with limit=3, assert <=3 distinct attempts via cursor updates/job error keys and <=3 provider hits, next invocation rotates beyond failed keys, both periodic issues eventually exist. Keep an existing manual period and verify content/origin/revision equality and zero extra requests. Assert shutdown prevents next attempt; a budget refusal preserves retryable missing issue. No injected production compose callback is necessary: use stored publications and local stub plus synthetic clock/date.
- [ ] Synchronize GREEN; create `rshot_upgrade_core_reports_green_test`; run report-candidates/reports-oss-due/reports-oss-recovery/report-preservation/rshot-report-catchup/curation/preview-export tests and typecheck. Verify API/Pages `editorialMode` and date fields unchanged. Review checkpoint.

```powershell
New-CoreQaDb rshot_upgrade_core_reports_green_test
Test-CoreQa rshot_upgrade_core_reports_green_test @('tests/report-candidates.test.ts','tests/reports-oss-due.test.ts','tests/reports-oss-recovery.test.ts','tests/report-preservation.test.ts','tests/rshot-report-catchup.test.ts','tests/curation.test.ts','tests/preview-export.test.ts')
```

## Task 4: Public predicates and safe derived-event invalidation

**Files:** Create backend `publication/scope.ts`, `events/derived-content.ts`, `events/corrections.ts`, `publication/hot.ts`, migration **0042_oss_domain_recovery.sql**. Modify `admin/{content,sources}.ts`, `publication/{publish,detail,feeds,groups,pool,reports,sitemap,stories,timeline,topics,v1}.ts`, `events/{group,digest,merge,hot,hot-read}.ts`, `site/stats.ts`, `jobs/events.ts`, API `routes/{site,og}.ts` as needed for safe reads/cache headers. Required cache support may touch `lib/cache.ts`. Calibration audit writer adapts to audit(tx), preserving label transaction/data. No events/recall/consolidate rewrite, heat algorithm expansion, typed Admin contract rewrite, reader image changes or new Agent endpoint.

**Interfaces:** import the fixed upstream scope predicates with unchanged aliases p/s/fa. `digestReports(storyId:number,db:Db=sql,now:Date=new Date()):Promise<DigestReport[]>`; `digestInputsHash(reports:DigestReport[]):string`; `lockStoryMembership(db:Db):Promise<void>`; `invalidateStoryInputs(db:Db,articleIds:string[],now?:Date,removedFactIds?:number[]):Promise<void>`. Keep `composeStoryDigest(storyId,{afterCorrection?})`, detachFromFact/mergeStories signatures and current groupArticle/GroupResult exports. Add requestRegroup(articleId,requestId,db=sql). Hot public exports retain latestHotRanking/rankingExtras/loadHotStrip; backend events/hot provides storedHotRanking(db=sql).

- [ ] Port upstream withdrawal fixture/withdrawal/digest-race/core-admin-corrections/core-source-promotion/hot-cover-scope/timeline-release/topic-release/topic-detail-counts tests. Adapt ai-models -> rs-tools and company topics/tags to synthetic RSHOT tags. For real RED, import detachFromFact from existing admin/content, loadHotStrip/HotEntry from existing events/hot-read; these paths stay compatible after GREEN. Adapt migration fixture path to 0042; run historical-migration-specific case after schema addition, not as missing-file RED. Run other assertions on `rshot_upgrade_core_scope_red_test` before production changes.

```powershell
New-CoreQaDb rshot_upgrade_core_scope_red_test
docker exec rshot-upgrade-test-db psql -U postgres -d rshot_upgrade_core_scope_red_test -v ON_ERROR_STOP=1 -c 'ALTER TABLE story_digests ADD COLUMN context_article_ids text[];'
Test-CoreQa rshot_upgrade_core_scope_red_test @('--test-name-pattern=^(?!兼容迁移)','tests/events-oss-withdrawal.test.ts','tests/events-oss-digest-race.test.ts','tests/core-admin-corrections.test.ts','tests/core-source-promotion.test.ts','tests/hot-cover-scope.test.ts','tests/timeline-release.test.ts','tests/topic-release.test.ts')
```

The negative-name pattern excludes only the SQL file repair case until its new migration exists; record that single exclusion, not a false RED. Test-only nullable context schema prevents irrelevant missing-column errors.

`topic-detail-counts.test.ts` imports new loadTopicDirectory and is run in GREEN after that API exists; its initial absence is not counted as functional RED. Existing loadTopicPage and API topic release tests establish RED against callable baseline behavior. No missing export is hidden by a skipped whole suite.
- [ ] Add scope predicates; import them into every listed read face using correct joins. Story evidence permits current editorial historical/noneligible reports, model digest input additionally requires listedCondition; mentions/composite analyses never prove a fact. Live source demotion must exclude event claims before background republish. Summary-only may keep its own permitted detail summary but leaves event inputs. Pause/fulltext-only revocation does not unnecessarily erase still-valid public summary prose.
- [ ] Extract/public-reader hot code: create publication/hot with live eligibility/membership filtering and safe representative fallback; put stored ranking read in events/hot. `events/hot-read.ts` becomes an explicit compatibility re-export of public functions and HotEntry/HotRanking types, preserving consumers; API/site imports publication/hot. Keep current heat generation behavior except necessary scope/evidence filter correctness.
- [ ] Add derived invalidation: membership advisory lock, sorted story row locks, current membership plus latest digest dependency IDs plus removed fact IDs. Store old text/fact frames in private audit; replace title with current safe evidence and clear digest/latest/frame fields; increment version; enqueue afterCorrection digest using tx and generation singleton key. Permission/copy correction, override write, projection/ledger, queue and audit must all commit together. Recompute ranking after commit while public reader checks live scope.
- [ ] Move detach/merge/requestRegroup to corrections with same exports; `admin/content.ts` re-exports detachFromFact/mergeStories to avoid API/script breakage. `rerun` uses requestRegroup in its transaction. Source demotion invalidates immediately; promotion uses Task-2 resumeSourceArticles. Source settlement locks source before article; no actual source enabling/config change. Duplicate address/source creation lock uses current supported free-source config.
- [ ] Graft grouping safety into existing group.ts: ArticleRow/select includes revision; latest analysis includes id; snapshot current public title/summary/visibility before judging; refuse withdrawn/isolated; use corrected public text, and drop old analysis fact frame if public text differs. Final write takes article then membership lock and compares current revision, latest analysis id, source mode, effective override/public visibility and title/summary to starting snapshot. On mismatch return standalone with no story/fact write and complete saved receipts; avoid consolidation/rematch on a null story. Verify target story still live before attachment. resetAutomatic invalidates only removed automatic facts; manual membership and standalone overrides retain priority. merge locks membership then sorted story ids; digest version prevents resurrecting pre-merge result. These guards are required stage-2 safety, not a grouping algorithm change.
- [ ] Digest: only current digestReports inputs; hash IDs + title + summary + source + firstParty + dates; store full guard IDs and actual <=40-report context plus proven inherited context. Old missing context forces fresh composition, no old story title in prompt. After HTTP, under story lock compare live version and complete input hash; stale result completes receipt but cannot write. Add 0042 SQL based on fixed-upstream data repair with old content saved in audit; both story and fact fallback queries must use the same valid membership/analysis-evidence boundary as runtime recovery, excluding mention/composite claims. This review ruling amends the original byte-identical requirement before production application, preserving numbering, audit and unaffected manual rows. Stop-old-services requirement is deployment documentation only; do not migrate real data here.
- [ ] Adapt public read caches for release deadline and invalidated story/cover responses. If taking topic refreshAt, include cached.expiresAt and API cacheUntil handling as one dependency; preserve response fields used by Pages. Use upstream OG story cache expiry fix to prevent fresh old-prose responses; no new rendering features. Keep schemas/editorialMode and Pages whitelist stable.
- [ ] Synchronize GREEN; create `rshot_upgrade_core_scope_green_test`; run listed ported tests plus publication/events/hot-avatar-payload/curation/calibration/collection-admission/preview-export/publish-guard and typecheck. Regression cases cover failed audit/queue rollback, stale command idempotency, concurrent withdrawals, first grouping answer after correction, demotion before republish, moved old digest input withdrawal, private audit preservation and public marker absence in website/API/RSS/MCP/OG.
- [ ] Verify 0042 migration fixture preserves audit before snapshots and does not alter unrelated synthetic story/manual override/calibration tables; fixture runs in transaction/temp or isolated database. Final-review ruling additionally requires repair-target discovery for recorded/current legacy dependencies that fail runtime evidence/membership rules, including still-public mention/composite inputs with another valid report remaining. Repair must protect the first post-migration read without a later model job; unrelated safe manual controls remain byte-equivalent. Review checkpoint.

```powershell
New-CoreQaDb rshot_upgrade_core_scope_green_test
Test-CoreQa rshot_upgrade_core_scope_green_test @('tests/events-oss-withdrawal.test.ts','tests/events-oss-digest-race.test.ts','tests/core-admin-corrections.test.ts','tests/core-source-promotion.test.ts','tests/hot-cover-scope.test.ts','tests/timeline-release.test.ts','tests/topic-release.test.ts','tests/topic-detail-counts.test.ts','tests/publication.test.ts','tests/events.test.ts','tests/hot-avatar-payload.test.ts','tests/curation.test.ts','tests/calibration.test.ts','tests/collection-admission.test.ts','tests/preview-export.test.ts','tests/publish-guard.test.ts')
```

## Task 5: Admin session authority binding

**Files:** Add **database/migrations/0043_admin_session_binding.sql**; modify backend `admin/auth.ts` and API `routes/admin-auth.ts` only for auth/validation needs. Add upstream tests `admin-session-migration.test.ts`, `admin-session-revocation.test.ts`. Keep synthetic password/Feishu interception entirely test-local; do not open auth files or rotate installed credentials.

**Interfaces:** passwordLogin/completeLogin/sessionPrincipal/endSession/actorOf signatures unchanged. Internal SessionAuth `{method:'password'|'feishu',binding:string,claims:FeishuClaims|null}` and FeishuClaims `{appId:string,unionId:string|null,email:string|null}`. sessionPrincipal returns same AdminPrincipal or null; invalid/legacy session hash deleted. adminHandler continues shared session+CSRF guard and adds ZodError -> invalid_request 400 when public-correction Zod validation needs it.

- [ ] Port session revocation test before production auth edits; it imports existing APIs. Verify fake OAuth rewrites passport.feishu.cn to loopback and unknown URLs cannot leave the internal network. Run RED on `rshot_upgrade_core_sessions_red_test`; expected old password/app/allowlist authority continues to authorize old cookies. Preserve existing CSRF/expiry/logout tests as GREEN controls.

```powershell
New-CoreQaDb rshot_upgrade_core_sessions_red_test
docker exec rshot-upgrade-test-db psql -U postgres -d rshot_upgrade_core_sessions_red_test -v ON_ERROR_STOP=1 -c "ALTER TABLE admin_sessions ADD COLUMN auth_method text CHECK (auth_method IN ('password','feishu')), ADD COLUMN auth_binding text, ADD COLUMN auth_claims jsonb;"
Test-CoreQa rshot_upgrade_core_sessions_red_test @('tests/admin-session-revocation.test.ts')
```

As in processing RED, nullable binding columns are test fixture schema only; baseline auth fills none, and authorization/claim assertions fail on behavior.
- [ ] Append exact upstream SQL as 0043 with IF NOT EXISTS; adapt filename assertion from 0041 -> 0043; assert all migration number prefixes unique and original 0039/0040 names still exist. Bind password to snapshot effective password and session secret; Feishu to original verified normalized claims/current app, using HMAC fixed ordering. On read verify effective current authority; retain OR union/email semantics and secret-only app rotation behavior; malformed or unbound fails closed.
- [ ] Retain cookie/signing/redirect/constant-time checks and dev-only guard. Legacy sessions are not backfilled. Observe invalid session once -> row deleted, restoration of old config cannot revive that cookie. Continue using shared audit compatibility export.
- [ ] Synchronize GREEN; create `rshot_upgrade_core_sessions_green_test`; run session-migration/session-revocation/calibration/publication tests and typecheck. Test protected calibration read/write with synthetic password session and CSRF to ensure customization remains guarded; anonymous public endpoints do not depend on admin identity. Review checkpoint.

```powershell
New-CoreQaDb rshot_upgrade_core_sessions_green_test
Test-CoreQa rshot_upgrade_core_sessions_green_test @('tests/admin-session-migration.test.ts','tests/admin-session-revocation.test.ts','tests/calibration.test.ts','tests/publication.test.ts')
```

## Task 6: Integrated verification and reviewed stage-2 handoff

- [ ] Verify appended migrations filenames, unchanged installed migrations, no dependency/package diff, no industry/data changes, no task installer/lifecycle deletions. `git diff --check` is read-only. Keep stage-1 changes intact. Update tracked deployment note only if controller includes it in stage-2 scope: old services stopped before schema and private backup required; actual deployment not executed in this draft.
- [ ] Synchronize all approved files; create fresh `rshot_upgrade_core_all_green_test`; run full Linux `npm test` on the same Test-CoreQa environment by passing `@('tests/*.test.ts')` (Node expands the test glob). Capture complete summary in ignored log; current test set will exceed 213 after imports. Require zero unexpected skips/fails and Linux signal tests passing. Do not call public source checks, model probes/evaluators or live scripts.

```powershell
New-CoreQaDb rshot_upgrade_core_all_green_test
Test-CoreQa rshot_upgrade_core_all_green_test @('tests/*.test.ts')
```
- [ ] Windows with flags false, credentials/profile paths nonexistent, optional DB flags false:

```powershell
$env:MODEL_CALLS_ENABLED='false'; $env:COLLECT_ENABLED='false'
$env:FEISHU_CONTENT_PUSH_ENABLED='false'; $env:FEISHU_INTERNAL_ENABLED='false'
$env:INDEXNOW_SUBMIT_ENABLED='false'; $env:AIHOT_CREDENTIALS_DIR='C:\nonexistent-rshot-test-credentials'
$env:RSHOT_MODEL_FILE='C:\nonexistent-rshot-model.env'
$env:FREE_SOCIAL_DB_TEST='false'; $env:FREE_SOCIAL_READER_DB_TEST='false'
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
npm run typecheck
node --test --test-concurrency=1 tests/free-social.test.ts tests/free-social-reader.test.ts tests/preview-publication-recovery.test.ts
npm run build -w @aihot/web
node --test apps/web/tests/*.test.ts
```

Require at least preserved 51 pass/2 intentional skips for the same Windows fixture group unless test additions increase count. Pages build uses a synthetic snapshot in the disposable Linux workspace, not live API/DB/real credentials. build-preview.ts has no argument parser; do not pass --help or invoke real export/publish scripts. Exact schema/build check:

```powershell
docker exec -w /workspace -e MODEL_CALLS_ENABLED=false -e COLLECT_ENABLED=false -e AIHOT_CREDENTIALS_DIR=/nonexistent-test-credentials -e RSHOT_MODEL_FILE=/nonexistent-rshot-model.env rshot-upgrade-qa node --input-type=module -e 'import {mkdirSync,writeFileSync} from "node:fs";import {PublicPreviewSchema} from "./scripts/lib/public-preview.ts";const at="2024-01-02T00:00:00.000Z";const data=PublicPreviewSchema.parse({schemaVersion:1,generatedAt:at,categories:[{key:"paper",label:"论文方法"}],sources:[{name:"Synthetic",kind:"rss"}],items:[],reports:[{kind:"daily",key:"2024-01-02",title:"Synthetic editorial issue",generatedAt:at,editorialMode:"manual",lead:null,overview:null,sections:[]}]});mkdirSync("industry/preview",{recursive:true});writeFileSync("industry/preview/snapshot.json",JSON.stringify(data));'
docker exec -w /workspace -e MODEL_CALLS_ENABLED=false -e COLLECT_ENABLED=false -e AIHOT_CREDENTIALS_DIR=/nonexistent-test-credentials rshot-upgrade-qa node scripts/build-preview.ts
```
- [ ] Local smoke is against a QA API/web pair with test DB, all valves false and internal-only network; inspect scripts/smoke.ts commands before starting QA processes. Record actual local URL/processes and gate results in controller report. CI/online snapshot/live smoke/deployment are later authorized integration gates and must not be claimed from these isolated results.
- [ ] Controller reviews each scoped task commit and the integrated diff before integration. Stage-2 final commit contains only its enumerated source/migrations/tests/docs; ignored plan/logs stay ignored. No new model APIs, model evaluations, media/Agent feature or upstream grouping-refactor source enters the stage-2 commit.

## Compatibility exports and deferred boundaries

| Module | Compatible bridge | End state / reason |
| --- | --- | --- |
| admin/auth | re-export audit from shared audit.ts; old seventh string requestId accepted | auth stays buildable while lower-layer imports migrate. |
| admin/sources | re-export shared Conflict | Existing instanceof checks use one class. |
| admin/runs | re-export releaseReceipt/autoReleaseUnknownReceipts from operations/recover | Old API imports remain buildable; schedule uses new owner. Keep resolveDelivery unchanged in stage 2. |
| admin/content | re-export detachFromFact/mergeStories from events/corrections | Existing admin routes/scripts compile while event owner becomes authoritative. |
| events/hot-read | re-export public functions/types from publication/hot | Existing tests/internal references compile; public routes switch to publication path. |
| jobs/queue | re-export shutdownSignal from lib/shutdown; retain enqueue and direct boss.work shape | No all-jobs rewrite or cron payload refactor needed. |
| events/group | retains warmRecallWindow/linkRelatedStories and existing recall/consolidate internals | Embedding test imports adapt to existing export; no new recall.ts/consolidate.ts dependency. |
| contracts/site + publication/reports | retain editorialMode; optional issue numbering remains deferred | Pages whitelist/report editor mode remains intact. |

Necessary dependencies: transaction audit/Conflict/shutdown/queue recovery; receipt state ownership; processing tag/revision guards and complete embedding persistence; report candidate/publish commit coordination; scope/invalidation/digest provenance and grouping final guard; auth binding migrations/read checks. Deferred: marked/content Markdown parser, image/fullUrl/GIF preparation and media queue variants, Agent Markdown HTTP and MCP answer refactor, period API/issue ordinals, leaderboard/monitor upgrades, grouping recall/consolidation split and heat-window feature expansion, notification resend/card refactor, typed Admin/JobData general refactor and real eval scripts. Existing feature flags remain closed.

## Self-review and blockers

Four spec clusters map to Tasks 1+2, 3, 4, 5; migration names/compatibility exports and RSHOT preservation cases are explicit. All test names and current interfaces were inspected; source sync copies only tracked/explicit task files. No production file/DB/auth/API/index/branch was changed to prepare this plan.

No architecture blocker found. Before execution the controller must finish reviewed stage 1 and synchronize that tip into QA (QA has been synchronized through reviewed source commit 7300442; synchronize the final stage-1 tip before stage 2). Fixture-only test adaptations must precede RED so upstream AI taxonomy/prompt/import assumptions do not create false failures. Any unexpected dependency or behavior conflict is resolved within the named cluster; it does not authorize widening stage 2 into deferred feature enablement.
