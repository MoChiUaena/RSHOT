# RSHOT upstream stage 3 reading implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. No production integration until the full preservation gates pass. User approval for this staged upgrade is already recorded in the spec.

**Goal:** Adopt applicable AIHOT reading fixes in the full website and adapt browser bookmark/date safety to the independent Pages reader.

**Architecture:** Keep existing storage keys and publication contracts. Port upstream browser state, media, and chronology improvements selectively into reviewed stage-2 code; Pages stays a static, anonymous summary reader with the same navigation and snapshot whitelist.

**Tech stack:** Node.js >=24.11, TypeScript, React 19/React Router, PostgreSQL 17 fixture databases, existing sharp and image proxy. The sole new package is fixed upstream marked 18.0.14 for sanitized third-party Markdown structure.

**Spec:** `docs/superpowers/specs/2026-10-03-rshot-upstream-upgrade.md`. Fixed upstream `3343fe2`; original live baseline `dfba98f`. Execute only after reviewed stage 2.

## Global Constraints

- Preserve RSHOT brand, six categories, topics, sources, prompts, calibrated thresholds, editorial bundles and manual USGS/West Africa correction. Use synthetic fixtures, never private labels/authorization files.
- Preserve admission limits, original identity/date checks, free social adapters and wrappers, local model configuration and secret protection. Keep WeRead retired and leaderboard/Codex reset modules off.
- Preserve anonymous publication-only website/API/RSS/MCP and Pages snapshot schemaVersion=1 field whitelist. Reader actions never call models.
- Windows publication/X tasks remain daily Beijing 10:30; October-7 review stop and current accounts/tasks/credentials are untouched. Retain worker stop-request/startup scheduling/heartbeat cleanup and Docker 4-minute stop grace.
- No real DB/API/model/source access. Tests use the internal QA network and disposable `_test`/`_ci` databases. Local-stub model tests alone may enable their test-only valve.
- Retain all reviewed stage-2 recovery, revision guards, curation preservation, report catch-up, public scope and session binding changes, as well as existing completionParameters and generic gateway request identity. No new migration in this stage.
- Storage formats already in readers' browsers must continue to work: full site uses existing aihot-* keys/version 1; Pages uses rshot-preview-starred string array and rshot-preview-theme. Do not rename these or silently erase corrupted original data.
- Keep Pages left sidebar/mobile tabs, all current routes, category/search, reports with editorialMode, source/topic lists, theme choices, pagination and original links. Fulltext/media are not added to its whitelist.

## Harness

Run in the upgrade worktree. Private `.data/upstream-qa/core-helpers.ps1` supplies Sync-CoreQa, New-CoreQaDb, Test-CoreQa, Assert-CoreQaOffline. Do not print, copy or commit its connection base. Sync before each Linux phase. Model/source flags false for build/migration; stub tests isolated with no default route. Test reports live in this plan's ignored SDD workspace. npm 11.19.0 is the known workspace-override-compatible version; retain root fflate 0.7.5 override.

Controller has prefetched `.data/upstream-qa/packages/marked-18.0.14.tgz` from npm. Its SHA-512 matches fixed-upstream package-lock exactly. This is only an archive; neither project nor QA dependencies were changed. Task 2 may install it into disposable QA node_modules offline using tar --strip-components=1, then keep QA network isolation. Do not commit the archive.

## Task 1: Browser state and Pages bookmark/date compatibility

**Files:** Modify `apps/web/app/lib/local-state.ts`, bookmark handlers in `apps/web/app/features/feed/parts.tsx`, `apps/web/app/routes/item.tsx`, `apps/web/app/routes/starred.tsx`; modify `apps/preview/app.js`; add `apps/web/tests/local-state.test.ts` and `tests/preview-reader.test.ts`; extend the existing `.github/workflows/pages.yml` test command with the new database-free reader tests. Only add a small Pages helper asset if tests require an importable boundary, and in that case update `apps/preview/index.html` and `scripts/build-preview.ts` to deploy it.

**Interfaces:** Full site toggleStar becomes Promise<boolean>, importBundle/mergeLocalData Promise<ImportReport>, markRead/removeStar Promise<void>; await/catch callers as appropriate. Pages still stores an array of IDs. Web Locks serialize one fresh read/merge/write per edit; browsers without locks still read storage fresh before changing it. Existing corrupt raw strings remain recoverable. Valid dates preserve exact value, invalid imported publishedAt becomes null and savedAt a displayable current ISO timestamp. Pages malformed item/update timestamps render a localized unknown label rather than aborting the reader.

- [ ] Port upstream local-state tests before source edits and record RED. Add exact Pages characterization in a VM with two independent documents sharing a fake Storage and queued Web Locks: both cache `[old]`; tab B saves B; tab A saves A before its storage event arrives; expected storage contains old, B, A. Then remove B from the stale tab and verify A remains. Do not test source-code substrings instead of behavior.

```ts
const before = storage.getItem('rshot-preview-starred');
await tabB.clickStar('B');
await tabA.clickStar('A');
assert.deepEqual(new Set(JSON.parse(storage.getItem('rshot-preview-starred')!)), new Set(['old','B','A']));
assert.notEqual(storage.getItem('rshot-preview-starred'), before);
```

- [ ] Add quota-denied and corrupt-data tests: no successful persistent toggle claimed, corrupted raw string unchanged, UI status explains unavailable persistence. Retain the existing session-only Pages fallback when storage is unavailable and verify successive session edits survive. Storage `key=null` refreshes star state and theme; matching keys update other tabs, unrelated keys do not. Cross-tab theme changes continue to obey system preference.
- [ ] Implement upstream state changes with minimal adapting caller signatures. For Pages never write the stale in-memory Set directly; lock/read fresh/merge the requested ID. Preserve corrupt data, separate session fallback from persisted data, and avoid replacing a valid other-tab write with fallback data. Date helpers must handle invalid ISO, missing date and display-zone overflow; do not call toISOString/Intl.format on an invalid Date. Unknown dates can be grouped with a neutral label after valid groups. Normal Beijing date/time behavior remains unchanged.
- [ ] Run Linux web tests and Pages VM tests; full Windows typecheck with all safety flags false. Build both readers; verify every previous Pages navigation item remains present and working in the synthetic reader harness. Test storage and date behavior with representative synthetic report/topic/source/item routes. Commit only task files, report commands and actual RED/GREEN counts.

```powershell
docker exec -w /workspace -e MODEL_CALLS_ENABLED=false -e COLLECT_ENABLED=false rshot-upgrade-qa node --test apps/web/tests/local-state.test.ts tests/preview-reader.test.ts
```

## Task 2: Sanitized Markdown and image reading pipeline

**Files:** Add `packages/backend/src/content/markdown.ts` and `packages/backend/src/lib/image-url.ts`; modify `packages/backend/src/content/extract.ts` only at Markdown conversion/import, `content/sanitize.ts`, `media/images.ts`, `media/imgproxy.ts`, `publication/items.ts` only at mediaView, `jobs/notify.ts` only prepareMedia payload dispatch, `apps/api/src/routes/media.ts`, `packages/contracts/src/site.ts` only optional MediaView.fullUrl, `packages/backend/package.json` and root lock; extend `tests/media-performance.test.ts`, add upstream `tests/markdown-body.test.ts`.

**Interfaces:** markdownBody(markdown:string,url:string):string parses GFM then always sanitizeBody/trimTrailingChrome. PreparedImage adds optional pendingAnimation; legacy produceImage callers still receive body/type. MediaView.fullUrl optional, added only responsive site image views; RSS old URLs unchanged. Existing media.prepare accepts `{articleId}` or `{url,mode}` without an all-jobs work wrapper refactor. Reader-triggered image preparation never invokes a model.

- [ ] Import fixed-upstream Markdown/media behavior regressions, adapt only synthetic industry names/URLs and retain the current tests. RED must cover pending animation cache behavior, binary MIME accepted only with decodable image bytes, tracking removal, fullURL site/RSS contract, proper tables/code/lists/links and sanitization. Reuse sharp-generated images and local HTTP stubs, never external image requests.
- [ ] Add marked 18.0.14 exactly; update only its workspace dependency and required lock entries using npm 11.19.0. Inspect lock diff, retain fflate override; if QA needs the newly fetched dependency, provide it from an approved public package tarball/cache without connecting the model/source test processes to external networks.
- [ ] Port upstream markdownBody and replace old homemade fallback converter; retain all stage-2 extraction revision/identity/rollback code. Port tracking image filtering into sanitizer and proxy for existing stored bodies. Port removal of `sizes=auto`, optional full signed image URL and upstream binary MIME validation. Do not widen original fetch/image pixel/byte caps or private-network policy.
- [ ] Port GIF preparation state, unique temp files, conversion completion marker and short pending cache; signed media HTTP queues a deduplicated non-model rendition preparation and uses no-store if enqueue fails. Extend existing notify job registration with a discriminated payload and keep generic boss.work/ensureQueue. Preserve selected-push retry logic unchanged.
- [ ] Verify upstream media-performance tests in fresh `rshot_upgrade_core_reading_media_red_test` / `rshot_upgrade_core_reading_media_green_test` using private helpers. Run core-extraction-consistency to guard revision/no-duplicate-X behavior after converter change, plus ingest/publication/preview-export to confirm scope and whitelist. Typecheck and scoped commit. No prepared production media or historical articles are rewritten by deployment.

## Task 3: Full website image viewer, chronology and own-site links

**Files:** Add upstream `apps/web/app/components/ui/Lightbox.tsx`; change image-only sections in `features/feed/parts.tsx`, `features/item/MediaGallery.tsx`; modify `routes/story.tsx`, `features/item/PosterSheet.tsx`, `routes/starred.tsx` only filename, `lib/markdown.ts`, `lib/site-copy.ts`; modify backend `publication/detail.ts` only export filename. Add `apps/web/tests/markdown.test.ts`, focused reader behavior tests if a new ordering helper is necessary, and backend export filename assertion in existing publication tests. Do not overwrite Task 1's async handlers or Task 2's scope/media projection.

**Interfaces:** Lightbox receives images, index, onIndex/onClose; shows full image, arrows, Escape, focus trapping/restoration, scroll restore and accessible controls. Story developments and report timeline share existing order state, sort copies without mutating loader data, newest fact marker stays tied to its identity. Trusted static copy renderMarkdown accepts site URL; prepareCopy supplies siteUrl(). Download names use SITE.mcpPrefix (rshot) while storage keys stay unchanged.

- [ ] Import upstream static Markdown link tests first: own root/domain path maps internally, other domains and prefix-lookalikes remain external; record RED. Add backend export filename assertion and synthetic chronology with reverse/equal dates if extracting a small used helper is required for a behavioral test.

```ts
assert.equal(link('[首页](https://news.example.com)'), '<a href="/">');
assert.equal(link('[外站](https://news.example.com.evil.test/a)'), '<a href="https://news.example.com.evil.test/a" target="_blank" rel="noopener noreferrer">');
```

- [ ] Port shared Lightbox and image callers; detail keeps video linking to original and shows up to nine existing available media entries. Use fullUrl when present; older data without it still opens url. Opening media must prevent feed navigation; closing and arrow buttons must not propagate a backdrop close. Retain responsive thumbnails, captions and source attribution; Pages stays summary-only.
- [ ] Port upstream chronology controls and own-site/filename changes. Existing local data import/export version and labels remain; site-copy/legal text itself remains user-approved text. No Agent Markdown endpoint or report ordinal feature is enabled; this stage repairs current readers only.
- [ ] Build/typecheck/full web tests. Verify keyboard/lightbox open-next-close-focus/scroll and story order with a locally served synthetic fixture/full QA route; no production content or external resources. A built/SSR and real-browser smoke can supply evidence for simple layout changes; do not create mirror assertions on JSX source. Report actual UI evidence and limitations, then scoped commit/review.

## Task 4: Integrated preservation and deployment readiness

**Files:** Controller verification report and ledger; update public upgrade notes/changelog only with verified changes. No new feature files.

- [ ] Run full Linux backend suite, full Windows typecheck, Windows free-social/publishing preservation, web build/tests, strict Pages snapshot/build and built-site smoke as required by AGENTS.md. Use a fresh fixture DB and isolated local services, no production models/sources.
- [ ] Compare against live dfba98f preserved-file list: industry categories/topics/sources/curation/prompts/thresholds, manual correction seed/history, model profile hooks/completionParameters, admission settings, Pages route whitelist, worker lifecycle and schedule scripts remain. Every changed shared path receives focused evidence. Check secrets before any GitHub operation.
- [ ] Whole-branch independent review from original dfba98f to final reviewed tip; fix and re-review in one wave according to SDD. Include earlier task findings/rulings. Deployment follows private backup and live service stop/migration/restart gates; post-deploy check real source counts/statuses, reports/manual revisions, service heartbeat, scheduled times, public snapshot and GitHub CI/Pages without new model calls.

## Self-review and boundaries

Task 1 async storage caller signatures compose with Task 3 image/filename edits in parts/starred; Task 2 optional fullUrl is consumed by Task 3 and excluded from Pages schema. Stage-2 public scope/extraction/job contracts are preserved by hunk-only edits. marked sanitizes external Markdown through the existing sanitizer; trusted static copy stays on its separate renderer. No new source, model evaluation, paid social service, report ordinal, leaderboard, notification resend or anonymous Agent route is required by this plan.
